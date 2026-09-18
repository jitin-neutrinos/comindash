# Implementation Plan Audit — Community Insights Dashboard

**Date:** 2026-09-11
**Scope:** `implementation-plan.md` (v2) audited against the code that actually exists in `app/`, the running stack, and the live database.
**Method:** full read of backend, worker, frontend and infra sources; live probes of the running containers (`app-backend-1`, `app-db-1`) and the Postgres database; attempted execution of the project's own validation harness.

---

## 0. Verdict

The plan is broadly **sound in architecture and largely implemented in skeleton**, but it is now **stale as a description of the system**, and the build has **five defects that make the delivered pipeline silently wrong or unrunnable outside its own containers**.

| Area | Plan says | Reality |
|---|---|---|
| Ingestion | Full backfill on first run, incremental after | Backfill truncated at 600 topics; older history unreachable forever |
| Analysis | Per-post NER + priority + sentiment through AI Hub | Works in stub mode; 52% of posts are re-analyzed every hour forever |
| Accuracy loop (WP2) | Review Hub HITL + weekly retrain + model registry | **Not implemented at all**; `model_versions` and `review_feedback` are empty tables |
| Assistant knowledge (WP3) | Analysis extract auto-refreshed into knowledge sources each cycle | **Not implemented**; only pre-existing knowledge-source IDs are passed |
| Quality bar | `pytest -q` green, `selfcheck.py` exits 0 | Both **crash on import** outside a container |
| Animation (D10) | Framer Motion | GSAP (deliberate swap, plan never updated) |
| Batch inference | Sync + batch AI Hub APIs | `predict_batch` written but **never called** |

Effort to close the gaps below is roughly **6–9 developer-days**, not counting the AI Hub model training that WP2 assumes.

---

## 1. Critical defects (evidence-backed)

### C1 — First-run backfill silently truncated at the page cap; history is unrecoverable

`app/backend/app/services/discourse.py:fetch_topics_since` pages `/latest.json` while `page < self.max_pages`, and `discourse_max_pages` defaults to 20. Discourse serves 30 topics per page, so the ceiling is 600 topics.

Live evidence:

```
 id | pages_done | status |           since_cursor
----+------------+--------+----------------------------------
  1 |         20 | done   | 2026-09-09T05:40:15.114000+00:00
```

```
  t  | p  | n
-----+----+---
 600 | 20 | 0
```

The first ingest hit the cap exactly (`pages_done = 20`, `topics_fetched = 600`), then wrote a `since_cursor` pointing at the *newest* topic. Every later run only looks forward from that cursor. **Everything older than those 600 topics can never enter the system**, and nothing in the run stats flags the truncation — the run is recorded as `status = done`.

This directly contradicts plan decision **D2 ("full backfill on first run")**.

Fix: distinguish a backfill pass (paginate to exhaustion, or until `more_topics_url` is absent) from an incremental pass; only apply `max_pages` to the incremental path; record `truncated: true` in run stats when the cap is hit.

---

### C2 — Half the corpus is re-analyzed every hour, forever

`extraction.py`, `priority.py` and `sentiment.py` each select "posts with no result row yet". For extraction that is:

```python
existing = await session.execute(select(Extraction.post_id).distinct())
done_post_ids = {r[0] for r in existing}
stmt = select(Post.id).where(~Post.id.in_(done_post_ids))
```

A post whose text matches no regex produces **zero** `Extraction` rows, so it is never "done" and is re-selected on every run.

Live evidence from the most recent analyze run (`pipeline_runs.id = 117`):

```json
"extraction": {"mode": "stub", "posts": 1076, "stage": "extraction", "entities": 0}
```

and from the database:

```
 no_extraction
---------------
          1076
```

1076 of 2082 posts (52%) are reprocessed hourly and yield nothing. In stub mode this is wasted CPU. **Once real `AIHUB_TOKEN_NER` is set, this becomes 1076 billed AI Hub inference calls per hour, permanently**, with no result ever stored.

Related, same file family: the `~Post.id.in_(done_post_ids)` pattern materialises every processed post id into Python and builds an `IN` clause of that size — at 100k posts this becomes a multi-megabyte query. And each post is then fetched with a separate `session.get(Post, pid)` (N+1).

Fix: record a sentinel/`analysed_at` marker per (post, stage) rather than inferring completion from the presence of result rows; replace the `NOT IN` with a `LEFT JOIN … IS NULL` anti-join and batch the post fetch.

---

### C3 — Every job writes two `pipeline_runs` rows

`worker/worker.py:execute_job` opens a run via `START_RUN_SQL` before calling the handler; the handler (`run_ingest`, `run_aggregation`, `run_assistant_cycle`) then creates its **own** `PipelineRun`. Live evidence:

```
 id  |   kind    | status |      triggered_by       |          started_at
-----+-----------+--------+-------------------------+-------------------------------
 117 | analyze   | done   | aggregation             | 2026-09-11 03:49:13.494319+00
 116 | analyze   | done   | worker-1                | 2026-09-11 03:49:13.493659+00
 115 | ingest    | done   | scheduler               | 2026-09-11 03:49:12.899255+00
 114 | ingest    | done   | worker-1                | 2026-09-11 03:49:12.898098+00
```

116 run rows exist for ~58 jobs. The worker's row and the service's row race to be "latest", so `/api/health`'s `last_run`, the Overview pipeline-health strip, and the admin Pipeline History all show duplicated and partly-empty runs (the worker rows carry `NULL` stats for ingest). Result rows (`extractions`, `priority_results`, …) are keyed to the service's `run_id`, so the worker's row is a permanent orphan.

Fix: one owner. Either the worker creates the run and passes `run_id` into the handler, or the worker stops creating runs and just reads the id the handler returns.

---

### C4 — Tests and self-check cannot run; the documented quality gate is broken

`app/backend/app/logging_config.py:32` unconditionally does `os.makedirs("/app/logs", exist_ok=True)`, and `app/main.py` calls `setup_logging("backend")` at **module import time**. Outside a container this raises before anything else happens:

```
tests/conftest.py:43: in <module>
    from app.main import create_app
app/main.py:16: in setup_logging("backend")
app/logging_config.py:32: in setup_logging
    os.makedirs("/app/logs", exist_ok=True)
E   PermissionError: [Errno 13] Permission denied: '/app'
```

Both `pytest tests -q` and `python app/selfcheck.py` (rc=1) fail this way, which means `scripts/validate.sh` — the project's stated validation harness — cannot pass. The SPEC quality bar ("leave tests green", "selfcheck must exit 0") is therefore unverified for every change made since logging was added.

Secondary: `backend/requirements.txt` gained `structlog`, `prometheus-fastapi-instrumentator` and `prometheus-client`, but the checked-in `backend/.venv` did not have them — imports failed there too until installed by hand.

Fix: make the log directory configurable (`LOG_DIR` env, default `./logs`) and degrade to stdout-only when it is not writable; move `setup_logging()` out of module scope into `create_app()`/`lifespan`.

---

### C5 — Nothing applies the database migrations

`alembic upgrade head` appears nowhere in `docker-compose.yml`, `backend/Dockerfile` (CMD is `uvicorn` only), `worker/Dockerfile`, or any entrypoint script. The only schema creation in the repo is `Base.metadata.create_all` inside `backend/tests/conftest.py`.

The currently running stack has tables only because they were applied by hand. A clean `docker compose up --build` — exactly what `README.md` instructs — produces an empty database and a backend that 500s on every route.

Fix: an init/migrate step (a one-shot compose service, or an entrypoint that runs `alembic upgrade head` before `uvicorn`).

---

## 2. Plan-to-reality drift (the plan now misdescribes the system)

| Plan statement | Actual |
|---|---|
| **D10** — "Charts: Recharts; animation: Framer Motion (reduced-motion respected)" | Recharts yes; **GSAP**, not Framer Motion. `framer-motion` appears nowhere in `package.json` or `src/`. Reduced-motion *is* respected (`gsap.matchMedia`, `index.css`), so the intent survived — the plan text did not. |
| **WP2** — "wire confidence-threshold routing to Review Hub; weekly retrain job consuming verified feedback"; "Model registry table: every model version, its validation metrics, active flag" | No Review Hub client, no confidence routing, no retrain job. `model_versions` = 0 rows, `review_feedback` = 0 rows. The tables exist; nothing writes them. This is the plan's headline "near-max accuracy" mechanism and it is entirely absent. |
| **WP3** — "knowledge source pipeline (auto-refreshed analysis extract per cycle)" | `assistant.py` passes `AIHUB_KNOWLEDGE_SOURCE_IDS` straight through. Nothing generates, uploads or refreshes an analysis extract. As built, the Analyst would reason over whatever was manually uploaded once. |
| **§2** — "inference via sync **+ async/batch** REST APIs" | `AIHubClient.predict_batch*` is implemented and **never called**. Every stage loops per post with a single synchronous call. At 2082 posts × 3 models this is ~6200 sequential HTTP round-trips per full pass. |
| **§5** — `priority_results(..., reviewer_source[human|none], ...)` | Column dropped between plan and `specs/SPEC.md`; models and migration have `reviewed` only. Minor, but plan §5 is no longer the schema. |
| **§5** — "Retention: raw analysis rows kept 18 months, aggregates forever" | No retention job of any kind. |
| **D7** — "post-level priority aggregates to topic and pain-point level … formula documented in-app" | `vote_priority` / `topic_priority_rollups` compute correctly but the result is only embedded in run stats. `assistant_insights.priority_rollup` is never written, no endpoint exposes rollups, and the formula is not shown in the UI. |
| **§8.4** — "Phase 1 runs entirely on kurama-core … Phase 2 packages the same stack" | Holds. Stack is up and healthy on localhost. |
| **WP7 / observability-plan §3.5** — `audit_logs` written on "insight-gate rejections, manual pipeline triggers, admin queries (sampled), settings changes" | `audit_logs` is written **only** by `GET /api/admin/logs`, on every call, unsampled. The insight gate writes its rejection audit into **`app_config`** instead (`insights_gate.py`), a table SPEC reserves for non-secret config. Two audit trails, neither matching the plan. |
| **observability-plan §3.4** — `/api/admin/logs?service=&level=&run_id=&request_id=&since=&until=` | Implemented params: `service`, `level`, `run_id`, `limit`. No `request_id`, no time range. |

---

## 3. Correctness and robustness findings (below critical)

**B1 — Assistant 429 handler never waits.** `assistant.py:_post` logs `Retry-After` and then immediately re-POSTs:

```python
if resp.status_code == 429:
    retry_after = float(resp.headers.get("Retry-After", "5"))
    logger.warning("aihub assistant rate limited — waiting %.1fs", retry_after)
    async with httpx.AsyncClient(...) as client:
        resp = await client.post(...)   # no sleep
```

`AIHubClient._post` does this correctly (`await asyncio.sleep(retry_after)`); the assistant path does not. The log line claims a wait that never happens.

**B2 — Assistant path has no retry/backoff at all.** `AIHubAssistant._post` is a bare `httpx` call. The plan's WP3 fallback ("if Assistant API fails a cycle, alert + retry") is satisfied only at the job-queue level, and only because the cycle exception is caught and the run marked failed — which means the *job* is marked **done**, not failed, so the queue never retries it either. A transient 502 loses the whole night's insights until the next cycle.

**B3 — `run_assistant_cycle` swallows failures from the queue's perspective.** The `except` branch marks the `pipeline_run` failed but returns a stats dict normally, so `worker.execute_job` takes the success path and calls `COMPLETE_JOB_SQL`. Same pattern in `run_ingest` and `run_aggregation`: **no pipeline failure ever triggers the job-queue retry/backoff/dead-letter machinery** the plan sells as self-healing (D3, WP6). The retry code is correct; nothing routes to it.

**B4 — Worker metrics are mislabelled.** `fail_job` emits `JOBS_PROCESSED.labels(kind="unknown", status="failed")` and `JOB_RETRIES.labels(kind="unknown")` regardless of the real job kind, so per-kind failure rates are unobtainable from Prometheus.

**B5 — Worker healthcheck will flap on long runs.** `touch_heartbeat()` is called only *after* a job completes; the healthcheck fails if the heartbeat is older than 120s. A full analyze pass over thousands of posts in real AI Hub mode will exceed that comfortably and mark the container unhealthy. (Docker won't restart it, so the effect is noise rather than an outage — but the signal becomes useless.)

**B6 — `AuditLog` model breaks the SQLite test path.** Every other model uses `JSONField = JSONB().with_variant(JSON(), "sqlite")`; `AuditLog.detail` uses raw `JSONB`. `Base.metadata.create_all` on SQLite (the test fixture) will fail on that column. Also `ts` is `DateTime` without `timezone=True`, unlike every other timestamp in the schema.

**B7 — Ingest cursor advances on partial results.** If page 3 of 20 fails after retries, `fetch_topics_since` logs and `break`s, keeping the topics collected so far; `run_ingest` then still sets `since_cursor` to the newest `last_posted_at` seen. The skipped pages are never revisited. Same failure shape as C1, different trigger.

**B8 — `deleted_at` is never written.** Topics deleted on Discourse remain `active` in the dashboard forever. The column exists in schema and plan; no code path sets it.

**B9 — Posts are never re-analysed after edit.** `_upsert_post` updates `body_text` on an edited post, but the analysis stages skip any post that already has a result row. An edited post keeps its stale priority/sentiment/entities permanently. Compounding, a new model version can never backfill existing posts — which nullifies plan **D6** ("comparisons across time are first-class") and the whole point of the append-only result tables.

**B10 — `sentiment` intensity default differs by mode.** Stub returns `0.0` for neutral; `_norm_real_sentiment` defaults missing intensity to `0.5`. The Overview `avg_sentiment` is an intensity-weighted signed mean, so switching to real models shifts the headline KPI for reasons unrelated to sentiment.

---

## 4. Frontend findings

**F1 — Admin page uses colour classes that do not exist.** `pages/Admin.jsx` uses `bg-background`, `bg-surface`, `bg-surface/30|50|80`, `text-primary`, `border-primary` (16 occurrences). `tailwind.config.js` extends only `theme.js:tailwindTheme.colors`, which defines `white, blue, mist, midnight, black, celeste, mint, salmon, iris, line, hairline, muted` — none of those. Tailwind emits nothing for them, so the page renders `text-white` on the default white body: **effectively invisible**. It is also built dark-first, which contradicts plan **D9** ("light theme ONLY").

**F2 — Data Explorer analysis badges never render.** Backend returns `{"analysis": {"priority": "medium", "priority_confidence": 0.65, "sentiment": "neg", ...}}` (verified live). `api.js:post()` reads `p.priority` / `p.sentiment`, which do not exist at that level, so both normalise to `null` and every row shows `—`. The per-post badges are a named WP5 deliverable.

**F3 — Data Explorer pagination and search are inert.** The page sends `{page, per_page, search}`; `/api/topics` and `/api/posts` accept `{limit, offset, q}`. Unknown params are ignored, so every page shows the same first 50 rows (backend default) while the footer computes pages from `PER_PAGE = 20`. "Next" changes nothing, and the search box does nothing.

**F4 — Priority-mix chart is always zero.** `/api/trends?metric=priority` returns the per-class counts inside `extra`: `{"date": "2026-08-14", "value": 8.0, "extra": {"low": 3.0, "medium": 5.0}}` (verified live). `api.js:trendPoint` reads `p.high`/`p.medium`/`p.low` at the top level, so `MetricsExplorer`'s `priorityData` sums undefined → 0 for all three classes.

**F5 — Entities chart is always empty.** `/api/trends?metric=entity` packs the entity name into `date` (`"PRODUCT:API"`). `trendPoint` looks for `p.entity ?? p.name ?? p.label` → `''`, and `MetricsExplorer` then does `.filter((d) => d.label)`, which drops every row.

**F6 — Build warnings for missing brand fonts.** `Poppins-LightItalic.ttf` and `Poppins-SemiBoldItalic.ttf` are referenced from `brand/tokens.css` but absent from `src/brand/fonts/`; Vite leaves the URLs to fail at runtime.

**F7 — Bundle is 735 kB (218 kB gzipped) in one chunk.** Not a defect, but worth a `manualChunks` split before go-live given Recharts + GSAP + lucide + date-fns are all eagerly imported.

---

## 5. Security and operational findings

**S1 — `/api/admin/*` is completely unauthenticated.** Plan §8.5 accepts "no auth locally", and compose binds to `127.0.0.1`, so this is *in policy* today. But `/api/admin/metrics/query` and `/metrics/query_range` take an arbitrary `query` string and proxy it to Prometheus, and `/api/admin/logs` proxies a LogQL selector built from user input. When Azure SSO lands, these must be gated by the `pe` role **and** the query parameters validated — an unvalidated proxy is the wrong thing to put behind a role check and forget.

**S2 — `INGEST_TOKEN` is still the default.** `app/.env` has `INGEST_TOKEN=chan…` — i.e. the shipped `change-me-local`. `/api/insights/ingest` is the assistant's write path into the insight store. Harmless while bound to localhost; must be a generated secret before the connector is pointed at anything reachable.

**S3 — A live Discourse admin API key sits in `app/.env`, and the project is not a git repository.** `app/.gitignore` does list `.env`, but there is no `.git` directory anywhere in the tree, so that protection is untested. Before `git init`, confirm `.env` is ignored from the first commit; if the key has ever left this machine, rotate it.

**S4 — `app/logs` is mode 777.** The worker container runs as uid 10001 and the backend as uid 1000, both writing the same bind mount; `worker.jsonl` is owned by `10001`. The directory was widened to `drwxrwxrwx` to work around the mismatch. Fix by giving both images the same uid (or using a named volume) and restoring 755.

**S5 — Log-viewer audit rows are written before the read is authorised or bounded.** `get_logs` inserts an `AuditLog` row on every call with the full LogQL query, and swallows the failure with a bare `sys.stderr.write('AUDIT ERROR: ...')`. Two leftover debug writes to stderr (`AUDIT ERROR`) are still in the file.

---

## 6. Repository hygiene

- **23 ad-hoc patch scripts** (`patch_admin*.py`, `patch_sidebar*.py`, `fix_sidebar.py`, `update_worker.py`, `patch_deps.py`, …) sit in the project root, plus `app/patch_audit.py`. They were one-shot editors; they are now indistinguishable from source.
- **`video.mp4` — 7.3 GB** in the project root.
- `app/db/migrations/` is empty; `README.md` describes it as "shared migration helpers". Real migrations live in `app/backend/alembic/versions/`.
- `README.md` states the frontend is on **:8081**; `docker-compose.yml` publishes **8082** (8081 is taken on this machine by `harness_searxng`).
- `backend/` contains scratch scripts committed alongside the app: `trigger.py`, `check.py`, `update_retry.py`, `test_db.py`, `query_audit.py`.
- `main.py` has `import` statements interleaved with executable code (`setup_logging` between two import blocks) and an unused `logging` import; `routes/topics.py` and `routes/posts.py` import `or_`/`Literal` unused. Minor, but `ruff` is configured (`.ruff_cache/` exists) and evidently not being run.

---

## 7. What the plan gets right

Worth stating plainly, because most of the structure is good:

- The **stage decoupling** (scheduler → DB job queue → worker → per-stage services) is the right shape, and `jobs.py` implements claim/backoff/dead-letter/watchdog correctly. It is only the wiring (B3) that fails to use it.
- **Stub mode** is a genuinely good decision and it works: the whole stack runs end-to-end with zero credentials, and the live database proves it (2082 posts, 2082 priority results, 2082 sentiment results, 3638 extractions).
- The **insight gate** (`insights_gate.py`) enforces D8 properly — schema validation, evidence-post existence check, per-item rejection, supersede-on-reinsert. The end-to-end test exercises it.
- **Discourse client politeness** — global inter-request throttle, `Retry-After` respect, semaphore, HTML/quote/onebox stripping — is better than the MVP it was ported from.
- **Brand system** (`theme.js` → `tailwind.config.js` → tokens) is clean and single-sourced, and reduced-motion is honoured. Only `Admin.jsx` escapes it.
- The **observability plan** is well-researched and the Loki/Promtail/Prometheus stack is up and scraping.

---

## 8. Recommended sequence

**Before anything else (half a day):** C4 then C5. Until the tests run and a clean `compose up` produces a schema, nothing below can be verified.

**Then, correctness (2–3 days):**
1. C3 — single owner for `pipeline_runs`.
2. B3 — make stage failures propagate so the queue's retry/dead-letter actually engages.
3. C2 — completion markers per (post, stage); anti-join instead of `NOT IN`; batch the post fetch.
4. C1 + B7 — separate backfill from incremental; never advance the cursor on a partial pass.
5. F2–F5 — four frontend/backend contract mismatches, all small.
6. F1 — either add `background`/`surface`/`primary` to the theme or rewrite `Admin.jsx` in the light brand system. The latter matches D9.

**Then, the plan's actual promises (3–4 days):**
7. WP2 accuracy loop: write `model_versions` on deploy, route sub-threshold predictions to Review Hub, ingest corrections into `review_feedback`, schedule the retrain job. This is the largest true gap.
8. WP3 knowledge-source refresh: generate and upload the analysis extract each cycle.
9. Batch inference: use `predict_batch` for the analyze stage.
10. B9 — re-analysis on post edit and on new model version, which is what makes D6 real.

**Then, plan maintenance (an hour):** update `implementation-plan.md` for the GSAP decision (D10), the dropped `reviewer_source` column (§5), and the audit-trail split (WP7); or record them as accepted deviations. A plan that no longer matches the build stops being a review artifact.

**Housekeeping, any time:** delete the 23 root patch scripts, move `video.mp4` out of the tree, `git init`, align the README ports, run `ruff`.

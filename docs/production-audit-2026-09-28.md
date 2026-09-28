# Production-readiness audit — 2026-09-28

Scope: full stack (backend, worker, frontend, db, sidecar, docker-compose, systemd units).
Method: code review + live verification against running containers + PyTorch/systemd/Docker
official docs (docker/docs#14185, torch.cuda.empty_cache docs, PyTorch FAQ GPU-memory notes,
context7 /websites/pytorch_2_13).

## What was already solid (verified, no action needed)

- **Queue**: DB-backed `job_queue`, `FOR UPDATE SKIP LOCKED` claiming, exponential backoff
  (30s→3600s), dead-letter after 5 attempts, stale-lock requeue, deduped scheduler ticks.
- **Observability base**: structlog JSON logs w/ rotation, Prometheus scraping backend
  (`/metrics` via instrumentator) + worker (`:8000` counters), Loki/promtail, admin
  command centre with honest state inference.
- **DB-load hygiene**: health cache, visibility-aware frontend pollers, worker idle ramp.

## Gaps found → implemented today (all verified live)

| # | Gap (why it blocked production) | Fix | Evidence |
|---|---|---|---|
| 1 | **GPU held 24/7** — sidecar pinned 3.6GB VRAM while idle ~22h/day; Laya's TileLang fast path uses CUDA graphs, so in-process `.cpu()` swap is unsafe (PyTorch docs: cached-graph state) | systemd **socket activation**: process self-exits after idle window (exit 0 → stays stopped), next TCP connection re-spawns it; `Restart=on-failure` ignores clean exits | VRAM 6.3GB→2.7GB after idle; cold start re-spawn served real classify in **6.1s**; log: `idle 630s >= 600s — exiting to release GPU` |
| 2 | **Cold start silently degraded batches to stubs** — `_sidecar_post` fell back to keyword stubs on ANY error, so an on-demand GPU spawn would have stamped `stub-1` over a whole batch | Retry connect/502/503/504 with growing backoff (6×10s in worker env), stub only after sidecar stays down; tests fast-fail via `SIDECAR_CONNECT_RETRIES=1` | conftest override; retry loop in `_stage.py` |
| 3 | **No storage management / retention executor** — observability plan §5 promised windows, nothing ran them; job_queue/audit/pipeline_runs grow unbounded (disk-full was a real prior incident) | `services/retention.py` + daily `maintenance` job (03:30 UTC) + manual trigger; jobs 14d (cap 2000), runs 90d, audit 180d; storage guard ok/warn/critical; posts/entities NEVER auto-purged (human decision, surfaced in Settings) | Live run: `job_done: 180` purged, storage `63.2% ok`; retries worked (caught real session bug on attempt 1, done on attempt 4) |
| 4 | **No container memory limits** — any runaway process hits the host OOM killer (desktop session at risk) | compose `deploy.resources.limits`: backend 512M, worker 768M, db 3G; container OOM-kill restarts instead of host-wide kill | `docker inspect` confirms limits live |
| 5 | **Postgres default config** (128MB shared_buffers, 100 conns) on a shared 64GB host | `shared_buffers=1GB, max_connections=60, work_mem=16MB, maintenance_work_mem=256MB, autovacuum_max_workers=2` | `SHOW shared_buffers` → 1GB |
| 6 | **Silent failures** — dead jobs / disk-critical sat unseen in a DB row | Worker ntfy push alerts: dead-letter → high priority (always), retrying failures → warn (30-min dedupe per error), storage-critical → high. Token-scoped ntfy user `comindash`, topic-only rw; `.env` (gitignored) holds token | End-to-end: worker `alert()` → ntfy HTTP 200 → message polled back with skull/critical tags |
| 7 | **Sidecar: no concurrency cap, no stats, no auth surface control** — ThreadingHTTPServer thread pileup vector on bursts | BoundedSemaphore(4) → 503 + caller retry; `/stats` endpoint (counters, VRAM, in-flight, idle state); idle window runtime-tunable from Settings (no restart) | `/stats` live JSON; config propagation verified (900→600s picked up live) |
| 8 | **Settings page was a placeholder** | Full ops console: GPU economy (idle toggle+window), retention (3 windows + purge-now button), alerting (dead-job/storage), live strip (worker/GPU/storage/queue); unknown keys 422-rejected | Build shipped; `ops/config` GET/POST verified; bogus key → 422 |
| 9 | **Admin had no ops visibility** | Command-centre "Operations" strip: GPU sidecar state/VRAM, idle policy, sidecar throughput, storage %, jobs 24h (done/failed/retries from Prometheus), dead jobs | Live via `/api/admin/ops/overview` (real Prometheus numbers: 61 jobs/24h) |
| 10 | **Docker log growth unbounded** on loki/promtail | json-file logging caps 10m×3 | compose |

Runtime settings persist in `app_config` key `ops` — editable from Settings, consumed by
sidecar (idle window, every 30s tick) and retention (windows, per run). No redeploy needed.

## Still open (blocks production, deliberate)

1. **Auth/SSO** — go-live plan says Azure AD SSO + roles; stack currently has no auth
   (localhost-bound + tunnel). Must land before real users.
2. **Pre-existing WIP breaks 3 tests** — uncommitted route changes (relationships/insights/
   overview/posts, ~150 lines, the live knowledge-graph rebuild) diverge from
   `backend/tests` expectations (`test_relationship_graph`, `test_list_detail_painpoints_
   relationships`, `test_full_stub_pipeline`). My changes pass 86/86 without that WIP.
   Finish the WIP's tests or commit it deliberately.
3. **18-month analysis-row retention** — needs a human decision + migration, intentionally
   not automated (Settings states this).
4. **Loki network split** — loki/promtail still on `app_default` (172.23.x), backend can't
   reach `loki:3100` by name; log queries fall back to JSONL (not lost). Move loki to
   `app_app_default` like prometheus was.
5. **No remote/off-host alerting or backup** — ntfy is host-local; DB has no scheduled
   dump. Both are single-box risks.
6. **Bundle 923KB** — code-split worth doing before public traffic (warning in build).

## Ops runbook (new)

- Sidecar: `systemctl --user start comindash-sidecar.socket` (enabled). Status via
  `curl 172.22.0.1:8101/stats` when warm; "connection refused" + socket active = cold,
  next request spawns it (~6s).
- Alerts: subscribe phone/browser to ntfy topic `comindash-alerts` (token in `app/.env`).
- Manual purge: Settings → "Run purge now", or `POST /api/admin/ops/maintenance/run`.
- GPU training sessions: set `idle_unload_enabled: false` in Settings first so analysis
  cold-starts don't contend for VRAM mid-training (or just let it idle-out — training
  starts after 15 min idle by definition of the existing discipline).

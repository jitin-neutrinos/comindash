# Neutrinos — Community Insights Dashboard (comindash)

Turns a Discourse community forum into prioritized, evidence-backed product insights.

The platform ingests topics and posts from a Discourse community, runs NLP analysis through a
host-run inference sidecar (fine-tuned **Laya** priority/sentiment classifier + **GLiNER** NER),
and produces nightly insight briefs via a **GLM (z.ai)** assistant cycle — surfaced in a branded
dashboard with cited sources for every claim. Every analysis stage has a deterministic stub
fallback, so the whole stack runs end-to-end with no models and no credentials.

Built for the Neutrinos community (700+ members, active): automated ingestion, a DB-backed job
queue with retries and dead-lettering, a nightly assistant cycle, an insight review queue, and
full observability (Loki + Promtail + Prometheus).

---

## Architecture

Four application services plus an observability stack, defined in
[`app/docker-compose.yml`](app/docker-compose.yml), with a host-run inference sidecar:

| Component    | Stack                          | Role |
|--------------|--------------------------------|------|
| `backend`    | FastAPI + async SQLAlchemy     | REST API, ingestion orchestration, analysis pipeline, admin/review endpoints |
| `worker`     | Python (DB-backed job queue)   | Claims jobs with `FOR UPDATE SKIP LOCKED`; retries with backoff, dead-letters after max attempts |
| `frontend`   | React (Vite) + nginx           | Branded dashboard: insights, pain points, trends, relationships, pipeline health, admin, settings |
| `db`         | Postgres 16 + pgvector         | Primary store; embeddings for similarity/relationship analysis |
| `loki` / `promtail` / `prometheus` | Observability        | Log aggregation and metrics across all services |
| inference sidecar (host) | Python, socket-activated | Laya (priority/sentiment) + GLiNER (NER); GPU held only while serving |

### How analysis runs

| Stage | Real backend | Stub fallback |
|-------|--------------|---------------|
| Priority / Sentiment | Laya classifier — sidecar `POST /classify` (`laya-v1`) | keyword heuristic / lexicon (`stub-1`) |
| NER | fine-tuned GLiNER — sidecar `POST /extract` (`laya-v1`) | regex (`stub-1`) |
| Assistant cycle | z.ai GLM: one extractor call per corpus chunk + one synthesis merge | skip mode (run recorded `skipped`) |

The sidecar is **socket-activated** (`comindash-sidecar.socket`): nothing holds the GPU while no
analysis is due, and it self-exits after an idle window, releasing all VRAM. The first call after
an idle window waits for the ~10–15s cold start (retried with backoff), and only falls back to
stubs if the sidecar stays down. Backend containers reach it over Docker's host gateway
(`http://172.22.0.1:8101`); on the host it is `http://127.0.0.1:8101`.

### Repository layout

```
app/                     Docker Compose stack (the deployable unit)
├── backend/             FastAPI service
│   ├── app/routes/      API surface: insights, overview, pain_points, topics, posts,
│   │                    trends, relationships, review, pipeline, admin, exports
│   ├── app/services/    Domain logic: ingestion, Discourse client, analysis (priority,
│   │                    sentiment, extraction, assistant, GLM client), insight briefs,
│   │                    claim checking, jobs, metrics, model review, scheduler
│   ├── alembic/         Migrations (entrypoint runs `alembic upgrade head`)
│   ├── tests/           pytest suite (API, pipeline, analysis, end-to-end)
│   └── .env.example     Every supported environment variable, documented
├── worker/              DB-backed job queue worker (ingest / analyze / assistant_cycle)
├── frontend/            React dashboard (Vite build, nginx serve)
│   ├── src/brand/       Neutrinos brand tokens, fonts, logos
│   └── src/components/  Dashboard UI components
├── scripts/             Ops utilities (validate.sh, comindash-db-backup.sh)
├── loki-config.yml, promtail-config.yml, prometheus.yml   observability config
├── docker-compose.yml   Full stack definition
└── README.md            Stack-level runbook (ports, env vars, stub mode)

ml/                      Inference sidecar — Laya (priority/sentiment) + GLiNER (NER),
                         host-run (socket-activated, GPU held only while serving)
docs/                    Design docs, audits, research, implementation plan
```

---

## Quick start

Runs end-to-end with no credentials — the analysis stages fall back to deterministic stubs
(`model_version="stub-1"`) and ingestion runs in public/keyless mode.

```bash
cd app
cp .env.example .env        # fill in tokens as needed; stubs work with none
docker compose up --build   # backend entrypoint runs `alembic upgrade head` first
```

| Service  | URL                                    |
|----------|----------------------------------------|
| Backend  | http://localhost:8080 (API docs at `/docs`) |
| Frontend | http://localhost:8082                  |
| Postgres | `127.0.0.1:5433` (user `insights`, db `insights`) |

### Environment variables (essentials)

| Var | Default | Purpose |
|-----|---------|---------|
| `DB_PASSWORD` | `insights_local` | Postgres password |
| `DATABASE_URL` | set by compose | Required when running outside compose |
| `DISCOURSE_BASE_URL` | `https://community.neutrinos.com` | Community site to ingest |
| `DISCOURSE_API_KEY` | — | Admin key, read-only (without it: public/no-auth ingestion where possible) |
| `ANALYSIS_SIDECAR_URL` | `http://172.22.0.1:8101` (containers) | Laya + GLiNER sidecar |
| `GLM_API_KEY` | — | z.ai key; **empty ⇒ assistant cycle runs in skip mode** |
| `GLM_MODEL` | `glm-4.5-flash` | Assistant model id |
| `INGEST_TOKEN` | `change-me-local` | Token for `POST /api/insights/ingest` |
| `SCHEDULER_ENABLED` | `true` | Backend APScheduler: hourly ingest+analyze, nightly assistant cycle |

Full list with defaults: [`app/.env.example`](app/.env.example) and the
[stack README](app/README.md#environment-variables).

---

## What it does

- **Automated ingestion** — Discourse topics/posts sync on a schedule with catch-up for missed
  runs; the worker claims jobs from a DB queue, not a manual trigger.
- **Analysis pipeline** — per-post entity extraction (GLiNER), priority and sentiment (Laya),
  served by the host sidecar with a deterministic stub tier so nothing hard-fails without models.
- **Insight briefs** — the GLM assistant synthesizes evidence-backed insights from the whole
  corpus (map-reduce: chunk extractors → synthesis merge); the gate supersedes the previous active
  set atomically, and failed runs are recorded as failed pipeline runs rather than silently dropped.
- **Review queue** — human-in-the-loop review endpoint for insights before they surface.
- **Dashboard** — Neutrinos-branded React UI: overview metrics, pain points, trends, relationships
  (pgvector similarity), pipeline health strip, admin, settings.
- **Observability** — Loki + Promtail for logs, Prometheus for metrics, surfaced in the
  admin/pipeline-health views.

## Development

```bash
cd app
docker compose up --build          # full stack
./scripts/validate.sh              # validation pass (selfcheck + pytest + worker smoke)
./scripts/comindash-db-backup.sh   # DB backup
```

Model inference runs on the host-side sidecar (`ml/pipeline/inference_server.py`, socket-activated
via `comindash-sidecar.socket` so the GPU is held only while serving); backend containers call it
over the compose host gateway. Without it the stack still runs in stub mode.

## Documentation

- [`app/README.md`](app/README.md) — stack runbook: ports, env vars, sidecar setup, validation
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — the v2 plan the system was built against
- [`docs/production-audit-2026-09-28.md`](docs/production-audit-2026-09-28.md) — production-readiness audit
- [`docs/observability-plan.md`](docs/observability-plan.md) — metrics/logging design
- [`docs/model-audit-2026-09-27.md`](docs/model-audit-2026-09-27.md) — Laya + GLiNER quality audit
- [`docs/go-live-2026-09-27.md`](docs/go-live-2026-09-27.md) — go-live record

## License

Proprietary — Copyright © Neutrinos. All rights reserved. See [LICENSE](LICENSE).

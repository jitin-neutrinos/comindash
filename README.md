# Neutrinos — Community Insights Dashboard (comindash)

Turns a Discourse community forum into prioritized, evidence-backed product insights.

The platform ingests topics and posts from a Discourse community, runs NLP analysis
(entities, priority, sentiment) through Neutrinos AI Hub models — with a deterministic
stub fallback so the whole stack runs with zero credentials — and produces daily
insight briefs surfaced in a branded dashboard with cited sources for every claim.

Built for the Neutrinos community (700+ members, active): automated ingestion,
nightly assistant analysis cycles, an insight review queue, and full observability
(Loki + Prometheus + Promtail).

---

## Architecture

Four application services plus an observability stack, all defined in
[`app/docker-compose.yml`](app/docker-compose.yml):

| Service      | Stack                          | Role |
|--------------|--------------------------------|------|
| `backend`    | FastAPI + async SQLAlchemy     | REST API, ingestion orchestration, AI analysis pipeline, admin/review endpoints |
| `worker`     | Python (APScheduler-style)     | Scheduled catch-up for missed nightly assistant cycles and background jobs |
| `frontend`   | React (Vite) + nginx           | Branded dashboard: insights, pain points, trends, relationships, pipeline health, admin |
| `db`         | Postgres + pgvector            | Primary store, embeddings for similarity/relationship analysis |
| `loki` / `promtail` / `prometheus` | Observability        | Log aggregation and metrics across all services |

### Repository layout

```
app/                     Docker Compose stack (the deployable unit)
├── backend/             FastAPI service
│   ├── app/routes/      API surface: insights, overview, pain_points, topics,
│   │                    posts, trends, relationships, review, pipeline, admin, exports
│   ├── app/services/    Domain logic: ingestion, Discourse client, analysis
│   │                    (sentiment, priority, extraction, assistant, GLM client),
│   │                    insight briefs, claim checking, jobs, metrics
│   └── .env.example     Every supported environment variable, documented
├── worker/              Scheduled background worker
├── frontend/            React dashboard (Vite build, nginx serve)
│   ├── src/brand/       Neutrinos brand tokens, fonts, logos
│   └── src/components/  Dashboard UI components
├── scripts/             Ops utilities (DB backup, validation)
├── docker-compose.yml   Full stack definition
└── README.md            Stack-level runbook (ports, env vars, stub mode)

ml/                      Inference sidecar — Laya (priority/sentiment) + GLiNER (NER),
                         host-run (socket-activated, GPU held only while serving)
docs/                    Design docs, audits, research, implementation plan
```

---

## Quick start

Runs end-to-end in **stub mode** with no credentials — sentiment via lexicon,
priority via keyword heuristics, NER via regex (`model_version="stub-1"`). Adding real
tokens switches models over with zero code change.

```bash
cd app
cp .env.example .env        # fill in tokens as needed; stub mode works with none
docker compose up --build   # backend entrypoint runs `alembic upgrade head` first
```

| Service  | URL                                    |
|----------|----------------------------------------|
| Backend  | http://localhost:8080 (API docs at `/docs`) |
| Frontend | http://localhost:8082                  |
| Postgres | `127.0.0.1:5433` (user `insights`, db `insights`) |

### Environment variables

**Required**

| Var | Purpose |
|-----|---------|
| `DB_PASSWORD` | Postgres password (compose default: `insights_local`) |
| `DATABASE_URL` | Set by compose for backend/worker; required when running outside compose |
| `INGEST_TOKEN` | Bearer token the assistant connector sends to `POST /api/insights/ingest` (`X-Ingest-Token` header) |
| `DISCOURSE_BASE_URL` | Community site to ingest, e.g. `https://community.neutrinos.com` |

**Optional — real ingestion + real AI**

| Var | Default | Purpose |
|-----|---------|---------|
| `DISCOURSE_API_KEY` | — | Admin API key, read-only scope (without it: public/no-auth ingestion where possible) |
| `DISCOURSE_API_USERNAME` | `system` | Username the key is issued for |
| `DISCOURSE_CATEGORY_ID` | — | Restrict ingestion to one category |
| `AIHUB_BASE_URL` | `https://aihub-staging.neutrinos.com` | AI Hub environment |
| `AIHUB_TOKEN_NER` | — | Bearer token for the NER/text-extraction model |
| `AIHUB_TOKEN_PRIORITY` | — | Bearer token for the priority classifier |
| `AIHUB_TOKEN_SENTIMENT` | — | Bearer token for the sentiment classifier |
| `AIHUB_ASSISTANT_TOKEN` | — | Bearer token for the analyst assistant |

The full stack also runs on a GLM (z.ai) path for assistant cycles and insight briefs,
degrading gracefully to deterministic fallback content on rate limits.

---

## What it does

- **Automated ingestion** — Discourse topics/posts sync on a schedule with catch-up for
  missed runs (worker), not a manual trigger.
- **NLP analysis pipeline** — per-post entity extraction (GLiNER NER), priority
  classification, and sentiment through AI Hub models, with a deterministic stub tier
  so nothing hard-fails without credentials.
- **Insight briefs** — the assistant synthesizes evidence-backed insight briefs from
  aggregated topics, with claim checking and cited sources; failed model calls are
  recorded as failed pipeline runs rather than silently dropped.
- **Review queue** — human-in-the-loop review endpoint for insights before they surface.
- **Dashboard** — Neutrinos-branded React UI: overview metrics, pain points, trends,
  relationships (pgvector similarity), pipeline health strip, and admin pages with
  observability integration.
- **Observability** — Loki + Promtail for logs, Prometheus for metrics, surfaced inside
  the admin/pipeline-health views.

## Development

```bash
cd app
docker compose up --build          # full stack
./scripts/validate.sh              # validation pass
./scripts/comindash-db-backup.sh   # DB backup
```

Model inference runs on the host-side sidecar (`ml/pipeline/inference_server.py`,
socket-activated via `comindash-sidecar.socket` so the GPU is held only while serving);
backend containers call it over the compose host gateway. Without it the stack still
runs in stub mode.

## Documentation

- [`app/README.md`](app/README.md) — stack runbook
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — the v2 plan the system was built against
- [`docs/production-audit-2026-09-28.md`](docs/production-audit-2026-09-28.md) — production readiness audit
- [`docs/observability-plan.md`](docs/observability-plan.md) — metrics/logging design
- [`docs/go-live-2026-09-27.md`](docs/go-live-2026-09-27.md) + [`docs/go-live-checklist.md`](docs/go-live-checklist.md) — launch records

## License

Proprietary — Copyright © Neutrinos. All rights reserved. See [LICENSE](LICENSE).

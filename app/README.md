# Neutrinos — Community Insights Dashboard

Turns Discourse community activity into prioritized insights: a FastAPI + Postgres/pgvector
backend ingests topics and posts, a host-run inference sidecar (fine-tuned **Laya** classifier +
**GLiNER** NER) extracts priority, sentiment and entities, and a nightly **GLM** assistant cycle
produces evidence-backed insights — surfaced in a branded React dashboard.

Every stage has a deterministic stub fallback, so the stack runs end-to-end with no models and
no tokens.

## Run locally

```bash
cp .env.example .env          # fill in tokens as needed (stub mode works with none)
docker compose up --build    # the backend entrypoint runs `alembic upgrade head` first
```

| Service  | URL                                    |
|----------|----------------------------------------|
| Backend  | http://localhost:8080  (API docs at `/docs`) |
| Frontend | http://localhost:8082                  |
| Postgres | `127.0.0.1:5433` (user `insights`, db `insights`) |

Without the sidecar the analysis stages run in stub mode (`model_version="stub-1"`): sentiment via
lexicon, priority via keyword heuristics, NER via regex. Point the backend at the sidecar and the
same stages switch to real models (`model_version="laya-v1"`) with zero code change.

## How analysis runs

| Stage | Real backend | Stub fallback |
|-------|--------------|---------------|
| Priority | Laya classifier via sidecar `POST /classify` | keyword heuristic |
| Sentiment | Laya classifier via sidecar `POST /classify` | lexicon + word-count margin |
| NER | fine-tuned GLiNER via sidecar `POST /extract` | regex |
| Assistant cycle | z.ai GLM (chunk extractor + synthesis merge) | skip mode (recorded `skipped`) |

The sidecar (`../ml/pipeline/inference_server.py`) is host-run and **socket-activated**: nothing
holds the GPU while no analysis is due, and it self-exits after an idle window, releasing all VRAM.
The first call after an idle window waits for the ~10–15s cold start (retried), then falls back to
stubs only if the sidecar stays down. Containers reach the host sidecar over Docker's host gateway
(`http://172.22.0.1:8101`); on the host it is `http://127.0.0.1:8101`.

## Environment variables

### Required for real ingestion
| Var | Purpose |
|-----|---------|
| `DB_PASSWORD` | Postgres password (compose default: `insights_local`) |
| `DATABASE_URL` | Set by compose for backend/worker; required if running outside compose |
| `DISCOURSE_BASE_URL` | Community site to ingest, e.g. `https://community.neutrinos.com` |
| `DISCOURSE_API_KEY` | Admin API key, read-only scope. Without it ingestion runs in public/no-auth mode where possible |
| `DISCOURSE_API_USERNAME` | `system` — username the key is issued for |
| `DISCOURSE_CATEGORY_ID` | Restrict ingestion to one category (optional) |

### Analysis models
| Var | Default | Purpose |
|-----|---------|---------|
| `ANALYSIS_SIDECAR_URL` | `http://172.22.0.1:8101` in containers, `http://127.0.0.1:8101` on host | Laya + GLiNER inference sidecar |

### Assistant cycle (z.ai GLM)
| Var | Default | Purpose |
|-----|---------|---------|
| `GLM_API_KEY` | — | z.ai key; **empty ⇒ skip mode** (cycle recorded as skipped, pipeline unaffected) |
| `GLM_BASE_URL` | `https://api.z.ai/api/coding/paas/v4/chat/completions` | GLM endpoint |
| `GLM_MODEL` | `glm-4.5-flash` | Model id (prod `.env` pins a stronger model) |

### Pipeline + retention
| Var | Default | Purpose |
|-----|---------|---------|
| `SCHEDULER_ENABLED` | `true` | Backend APScheduler: hourly ingest+analyze, nightly assistant cycle |
| `INGEST_INTERVAL_MINUTES` | `60` | Ingestion cadence |
| `ASSISTANT_CYCLE_HOUR` | `2` | Hour of day (UTC) for the assistant cycle |
| `ANALYSIS_BATCH_SIZE` | `500` | Posts analysed per stage per run |
| `INGEST_TOKEN` | `change-me-local` | Token for `POST /api/insights/ingest` (`X-Ingest-Token` header) |
| `RUN_RETENTION_DAYS` / `JOB_DONE_RETENTION_DAYS` / `JOB_DEAD_RETENTION_DAYS` / `AUDIT_RETENTION_DAYS` | `90` / `14` / `30` / `180` | Housekeeping windows |

### Observability + alerts
| Var | Default | Purpose |
|-----|---------|---------|
| `LOKI_URL` / `PROMETHEUS_URL` | `http://loki:3100` / `http://prometheus:9090` | Log/metric backends surfaced in the admin UI |
| `NTFY_URL` / `NTFY_TOPIC` / `NTFY_TOKEN` | `http://172.22.0.1:8086/` / `comindash-alerts` / — | Operational alerts; empty token disables |
| `STORAGE_WARN_PCT` / `STORAGE_CRIT_PCT` | `80` / `92` | Disk alert thresholds |
| `LOG_LEVEL` / `LOG_DIR` | `INFO` / `/app/logs` | Rotating JSONL fallback sink (unwritable ⇒ stdout only) |

A missing `GLM_API_KEY` puts the assistant cycle in skip mode; a missing sidecar puts the three
analysis stages in stub mode. The app never crashes on a missing value.

## Giving it real data

### 1. Discourse API key
1. Sign in to your Discourse community as an admin and go to **Admin → API → Keys** (`{DISCOURSE_BASE_URL}/admin/api/keys`).
2. **New API Key**: description `community-insights-dashboard`, user `system`, scope **Read only**.
3. Copy the generated key into `.env` as `DISCOURSE_API_KEY`.
4. Optionally set `DISCOURSE_CATEGORY_ID` (visible in a category's URL, e.g. `/c/engineering/42` → `42`).

### 2. Analysis sidecar
Run the host-side sidecar so the containers can reach it:

```bash
systemctl --user start comindash-sidecar.socket      # recommended (socket-activated, GPU on demand)
# or, foreground:
ml/laya/.venv/bin/python ml/pipeline/inference_server.py
```

Check `GET http://127.0.0.1:8101/health` returns `{"status":"ok","laya":true,"gliner":true,...}`.
Without it the stack still runs — every analysis stage falls back to its stub.

### 3. Assistant cycle
Set `GLM_API_KEY` to enable the nightly insight cycle. Then `docker compose up -d`.

## Validation

```bash
./scripts/validate.sh
```

Creates `.venv-validate`, installs backend + worker requirements, runs the backend selfcheck,
`pytest backend/tests -q`, and a worker smoke check (boot, connect-or-skip DB). Prints
`[ OK ]/[SKIP]/[FAIL]` per step; exits non-zero only on real failures.

## Layout

```
app/
├── backend/    FastAPI app, services, Alembic migrations, tests   → :8080
├── worker/     DB-backed job queue worker (ingest / analyze / assistant_cycle)
├── frontend/   React + Vite + Tailwind dashboard                  → :8082
├── scripts/    validate.sh, comindash-db-backup.sh
├── loki-config.yml, promtail-config.yml, prometheus.yml   observability stack
└── docker-compose.yml   full stack definition
```

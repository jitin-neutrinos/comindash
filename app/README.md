# Neutrinos — Community Insights Dashboard

Turns Discourse community activity into prioritized insights: a FastAPI + Postgres/pgvector backend ingests topics and posts, AI Hub models (with a deterministic stub fallback) extract entities, priority and sentiment, and an AI Hub assistant produces evidence-backed insights — surfaced in a branded React dashboard.

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

Without AI Hub tokens the whole stack runs end-to-end in stub mode (`model_version="stub-1"`): sentiment via lexicon, priority via keyword heuristics, NER via regex. Adding real tokens switches models over with zero code change.

## Environment variables

### Required
| Var | Purpose |
|-----|---------|
| `DB_PASSWORD` | Postgres password (compose default: `insights_local`) |
| `DATABASE_URL` | Set by compose for backend/worker (`postgresql+asyncpg://insights:…@db:5432/insights`); required if running outside compose |
| `INGEST_TOKEN` | Bearer-style token the AI Hub assistant connector sends to `POST /api/insights/ingest` (header `X-Ingest-Token`) |
| `DISCOURSE_BASE_URL` | Community site to ingest, e.g. `https://community.neutrinos.com` |

### Optional (real ingestion + real AI)
| Var | Default | Purpose |
|-----|---------|---------|
| `DISCOURSE_API_KEY` | — | Admin API key, read-only scope. Without it ingestion runs in public/no-auth mode where possible |
| `DISCOURSE_API_USERNAME` | `system` | Username the key is issued for |
| `DISCOURSE_CATEGORY_ID` | — | Restrict ingestion to one category |
| `AIHUB_BASE_URL` | `https://aihub-staging.neutrinos.com` | AI Hub environment (staging/sandbox first) |
| `AIHUB_TOKEN_NER` | — | Bearer token for the NER/text-extraction model |
| `AIHUB_TOKEN_PRIORITY` | — | Bearer token for the priority classifier |
| `AIHUB_TOKEN_SENTIMENT` | — | Bearer token for the sentiment classifier |
| `AIHUB_ASSISTANT_TOKEN` | — | Bearer token for the analyst assistant |
| `AIHUB_NER_DEPLOYMENT_ID` | — | Deployment id of the NER model |
| `AIHUB_PRIORITY_DEPLOYMENT_ID` | — | Deployment id of the priority model |
| `AIHUB_SENTIMENT_DEPLOYMENT_ID` | — | Deployment id of the sentiment model |
| `AIHUB_ASSISTANT_ID` | — | Assistant id for the analyst assistant |
| `AIHUB_KNOWLEDGE_SOURCE_IDS` | — | Comma-separated knowledge source ids mapped to the assistant |
| `SCHEDULER_ENABLED` | `true` | Backend APScheduler: hourly ingest+analyze, nightly assistant cycle |
| `INGEST_INTERVAL_MINUTES` | `60` | Ingestion cadence |
| `ASSISTANT_CYCLE_HOUR` | `2` | Hour of day (UTC) for the assistant cycle |

Any missing `AIHUB_TOKEN_*` ⇒ that stage runs in SKIP/stub mode (logged, pipeline run marked `skipped`) — the app never crashes on missing tokens.

The verified AI Hub REST contract (endpoints, bodies, response shapes) and the three v2 plan
commitments that have no API behind them are documented in `../implementation-plan.md` §9.

## Giving it real data

### 1. Discourse API key
1. Sign in to your Discourse community as an admin and go to **Admin → API → Keys** (`{DISCOURSE_BASE_URL}/admin/api/keys`).
2. **New API Key**: description `community-insights-dashboard`, user `system`, scope **Read only**.
3. Copy the generated key into `.env` as `DISCOURSE_API_KEY`.
4. Optionally set `DISCOURSE_CATEGORY_ID` (visible in a category's URL, e.g. `/c/engineering/42` → `42`).

### 2. AI Hub sandbox tokens

**One token per model is all you need.** An AI Hub token is scoped to a single model *and* a single
model version, and already carries the deployment binding (`ai-hub/tokens`) — no deployment id is
sent in any request. Tokens can only be created for models that are already deployed, and the value
is shown once.

| `.env` var | Where in AI Hub UI |
|------------|--------------------|
| `AIHUB_TOKEN_NER` | **Tokens** → Sandbox → **Add** → Training Type `Extraction`, Data Type `Text`, pick the NER model + version, Expiry **Never** |
| `AIHUB_TOKEN_PRIORITY` | same, Training Type `Prediction`, the priority model + version |
| `AIHUB_TOKEN_SENTIMENT` | same, Training Type `Prediction`, the sentiment model + version |
| `AIHUB_ASSISTANT_TOKEN` | same, Training Type `Assistant`, the analyst assistant + version |

Optional, for traceability only (recorded on `model_versions`, never sent in a body):
`AIHUB_NER_DEPLOYMENT_ID`, `AIHUB_PRIORITY_DEPLOYMENT_ID`, `AIHUB_SENTIMENT_DEPLOYMENT_ID`,
`AIHUB_ASSISTANT_ID`.

Leave `AIHUB_KNOWLEDGE_SOURCE_IDS` empty to auto-discover every knowledge source mapped to the
assistant. Leave `AIHUB_INPUT_FIELD` empty unless a model was trained from a multi-column CSV —
check a model's **Integration** page ("copy the cURL") to see whether it takes `{"text": …}` or
`{"input": {"<column>": …}}`.

Then restart: `docker compose up -d` — the pipeline switches from stub to real models automatically.

## Validation

```bash
./scripts/validate.sh
```

Creates `.venv-validate`, installs backend + worker requirements, runs the backend selfcheck, `pytest backend/tests -q`, and a worker smoke check (boot, connect-or-skip DB). Prints `[ OK ]/[SKIP]/[FAIL]` per step; exits non-zero only on real failures.

## Layout

```
app/
├── backend/    FastAPI app, services, Alembic, tests   → :8080
├── worker/     DB-backed job queue worker (ingest / analyze / assistant_cycle)
├── frontend/   React 18 + Vite + Tailwind dashboard    → :8081
├── scripts/    validate.sh
├── db/         shared migration helpers
└── specs/      SPEC.md — authoritative contracts
```

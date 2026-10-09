# Community Insights Dashboard — Implementation Plan v2 (AI Hub-Native)

**Project:** Neutrinos Community Discourse NLP Analysis & Insights Platform
**Folder:** `/home/notjitin/Work/Neutrinos/community-insights-dashboard/`
**MVP source:** `source/discourse-insights/` — audited in `source/source-audit.md`
**Status:** v2.1 — supersedes v1 per revised direction: **all analysis runs on Neutrinos AI Hub**
**Revised 2026-09-11:** §2, §4 WP2/WP3, §6 and the new §9 corrected against the AI Hub REST
contract (documentation.neutrinos.com, via the neutrinos-docs MCP). Three v2 commitments were
not buildable as written — see §9. Implementation audit: `docs/implementation-plan-audit.md`.
**Awaiting:** review/approval by Jitin before implementation begins

---

## 1. What This System Does (end to end)

1. **Ingests** every topic and post from the Neutrinos Discourse community (700+ members) automatically — scheduled, incremental, self-updating.
2. **Analyzes each post through a chain of AI Hub services:**
   - **Text Extraction model (NER)** → pulls structured entities (product names, modules, features, error types, people/teams mentioned).
   - **Text Prediction model #1 — Priority** → classifies every post High / Medium / Low with confidence score, trained and retrained toward maximum accuracy.
   - **Text Prediction model #2 — Sentiment** → classifies every post Positive / Neutral / Negative (plus intensity), same training/accuracy mechanics.
3. **AI Hub Assistant (the Analyst)** — a purpose-built assistant instructed as a senior data scientist / senior data analyst with community-forum analytics expertise. It receives the structured analysis results, identifies pain points, trends, correlations and relationships between components (e.g. "complaints about module X spike when feature Y changed", "negative sentiment clusters around topic Z"), and **pushes generated insights back into our system** through its connector.
4. **Stores everything** — every extraction, priority, sentiment, confidence score, and every assistant insight — in a fully structured, versioned database. Nothing is ever overwritten; history is the dataset.
5. **Displays it all** in a premium, animated, light-theme Neutrinos-brand dashboard: every metric, the analysis behind it, relationships between components, drill-downs to source posts, and the assistant's insights — infographics first, jargon none.

**Self-contained / self-healing / self-updating commitments:**
- *Self-updating:* scheduled ingestion + analysis + insight-generation cycles; no human ever clicks "refresh".
- *Self-healing:* every pipeline stage has retry with backoff, stuck-run detection and automatic restart, startup reconciliation of orphaned jobs, health checks with auto-restart (Docker `restart` + container healthchecks), and degraded-mode behavior (dashboard stays up showing last-good data with a visible staleness banner).
- *Self-contained:* single docker-compose stack, all credentials server-side, all AI through AI Hub endpoints, no external SaaS dependency beyond Discourse API + AI Hub + Claude Team.

---

## 2. AI Hub Capability Map (verified against documentation.neutrinos.com, AI Hub product docs, 2026-08-26 revision)

| Capability | AI Hub feature we use | Doc evidence |
|---|---|---|
| Priority classification (H/M/L) | **Text Prediction Model** — train on labeled CSV (category column), advanced config (stop-word/URL/char cleanup), validation via Single + Batch test with Accuracy, Precision, Recall, F1, Confidence; inference via sync + async/batch REST APIs | ai-hub/prediction, ai-hub/text-prediction-model, ai-hub/validate-text-models, ai-hub/integrate-apis-text-prediction |
| Sentiment analysis | **Text Prediction Model #2** — sentiment is a documented AI Hub use case ("Sentiment Analysis: AI-driven insights from customer feedback"); implemented as a sentiment-labeled text prediction classifier (3-class + intensity) | ai-hub/overview (Use Cases), ai-hub/prediction |
| Named entity extraction | **Text Extraction Model** — "Extraction: Named Entity Recognition" per architecture; entities returned as {text, label, start}; per-entity human-feedback-loop config (Always / below-confidence-threshold / Never) | ai-hub/extraction, ai-hub/architecture (Model Types), ai-hub/itextentity, ai-hub/text-extraction-model |
| Insight generation | **Assistant** — custom instruction (senior data scientist persona), Knowledge Sources (Excel/PDF/Word/webpage), conversation + message REST APIs, Review Hub (accuracy, feedback summary, audit history), accuracy/token dashboards | ai-hub/assistant, ai-hub/work-with-assistant, ai-hub/integrate-api-assistant, ai-hub/review-hub-assistant |
| Insight write-back to our backend | **Assistant Toolsets → API Connector** (REST with auth) — assistant invokes our secure `/api/insights` endpoint to push structured insights; MCP Connector available as alternative | ai-hub/toolsets, ai-hub/connectors |
| Accuracy guarantee loop | **Review Hub human-in-the-loop** — rule "Always" or "when confidence < threshold"; reviewer corrections feed retraining (active learning) | ai-hub/review-hub-text-model |
| Orchestration / chaining | Assistant harness + Autonomous Mode (multi-assistant chaining, guardrails, observability) — available if we later split the Analyst into multiple specialist assistants | ai-hub/autonomous-mode |

> **Correction (2026-09-11).** Three rows above describe capabilities that exist in the AI Hub
> *product* but have **no API**, so they cannot be driven from our pipeline. See §9.

**Accuracy strategy for priority ("near max accuracy possible"):**
1. **Bootstrap:** label an initial corpus (first ingestion) using Claude Team (deterministic, temperature-0 rubric) → produces the labeled training CSV.
2. **Train** AI Hub Text Prediction model on it; run Batch validation → record Accuracy/Precision/Recall/F1 per class as the baseline.
3. **Confidence routing:** predictions below a confidence threshold go to **Review Hub** for human verification (rule: below-threshold).
4. **Active-learning retrain loop:** verified human corrections accumulate in a training set; on a schedule (weekly), the model retrains on bootstrap + corrections. Target gates recorded per release: ≥90% F1 on High class before its outputs are trusted for leadership views (below that, dashboard labels the score "provisional").
5. Every prediction stored with `{model_version, confidence, reviewed_by_human}` — the dashboard can always show how much is machine-verified.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. INGESTION SERVICE (scheduler + worker)                          │
│    Discourse REST API → incremental since-cursor fetch             │
│    topics + ALL posts (first post + every reply), 429 backoff,     │
│    idempotent upserts, ingestion_state cursor per forum            │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2. AI HUB ANALYSIS PIPELINE (per new/updated post)                 │
│    a. Text Extraction (NER): entities {text,label,position}        │
│    b. Text Prediction: priority High/Med/Low + confidence          │
│    c. Text Prediction: sentiment Pos/Neu/Neg + confidence          │
│    Low-confidence items → AI Hub Review Hub (HITL) → retrain set   │
│    Every result stored with model_version + confidence + run_id    │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ 3. AI HUB ASSISTANT — "The Analyst"                                │
│    Instruction: senior data scientist + senior data analyst,       │
│    community-forum expertise. Knowledge source: analysis extract   │
│    (structured CSV/JSON of posts+entities+priority+sentiment+      │
│    aggregates, refreshed each cycle).                              │
│    Produces: pain points (ranked), trends, anomalies,              │
│    relationships/correlations between entities×topics×sentiment,   │
│    cited recommendations with links to source posts.               │
│    Pushes structured output via API Connector →                    │
│    POST /api/insights (authenticated, schema-validated).           │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ 4. DATABASE — PostgreSQL (+ pgvector optional)                     │
│    forums, topics, posts, ingestion_state, pipeline_runs,          │
│    extractions, priority_results, sentiment_results,               │
│    assistant_insights, insight_evidence, insight_relationships,    │
│    model_versions, review_feedback, job_queue, app_config          │
│    Everything versioned + immutable (append-only history)          │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ 5. API LAYER — FastAPI                                             │
│    Server-side credentials only; token auth + roles;               │
│    endpoints: overview, metrics, pain-points, insights,            │
│    relationships, trends, drill-down/evidence, exports,            │
│    pipeline health; /api/insights ingest endpoint for Assistant    │
└──────────────┬─────────────────────────────────────────────────────┘
               ▼
┌────────────────────────────────────────────────────────────────────┐
│ 6. FRONTEND — React + Vite + Tailwind (light theme, Neutrinos)     │
│    neutrinos-brand-core tokens + neutrinos-web build rules +       │
│    neutrinos-designer plugin assets (logo, icons)                  │
│    Infographic dashboard: KPI cards, charts, relationship maps,    │
│    drill-downs, insight cards — animated (Framer Motion)           │
└────────────────────────────────────────────────────────────────────┘
```

### Settled decisions (apply to all work packages)

- **D1 — Database: PostgreSQL in Docker**, full schema in §5, Alembic migrations, append-only analysis history.
- **D2 — Ingestion: incremental `since` cursor**, full backfill on first run, all replies stored (MVP stored only first posts).
- **D3 — Execution: DB-backed job queue + worker loop** (no BackgroundTasks). Stuck-job watchdog, startup reconciliation, per-stage retry. APScheduler drives the cycles.
- **D4 — All AI through AI Hub** per §2. Claude Team used only for the one-time bootstrap labeling (§2 accuracy strategy) — optional, droppable if AI Hub training data can be labeled by hand/initial assistant run.
- **D5 — Secrets server-side only** (env/secret file, never in DB or browser). Frontend never sees or sends any key.
- **D6 — Versioning everywhere:** every extraction/prediction/insight row carries model_version + run_id + timestamp; comparisons across time are first-class.
- **D7 — Priority formula for rollups:** post-level priority (AI Hub) aggregates to topic and pain-point level via confidence-weighted vote + recency decay; formula documented in-app.
- **D8 — Citations mandatory:** every assistant insight must reference the post ids/evidence it derived from; insights failing evidence validation are rejected at the `/api/insights` gate and logged.
- **D9 — Brand: light theme**, neutrinos-brand-core tokens (Poppins; White #FFFFFF + Neutrinos Blue #0066FF dominant; Mist Gray #F5F5F5 surfaces; Midnight Blue #00053D punctuation sections; one accent per view; pill tags/buttons; frame brackets; bundled logo assets from the neutrinos skill + neutrinos-designer plugin; charts per brand design-system rules — accent colors allowed in charts only).
- **D10 — Charts: Recharts; animation: Framer Motion** (reduced-motion respected).
- **D11 — Insights contract:** the Assistant writes to `/api/insights` with a fixed JSON schema (pain_points[], trends[], relationships[], recommendations[], evidence[]); backend validates, versions, stores; invalid payloads rejected with error logged for pipeline retry.

---

## 4. Work Packages

### WP1 — Backend foundation + ingestion (3–4 d)
- Compose stack: postgres, backend (FastAPI), worker, frontend. Alembic.
- Discourse incremental client (from MVP's `discourse_client.py`, kept: rate-limiting + HTML stripping; added: replies, since-cursor, category filter).
- Job queue tables, worker loop, scheduler (ingestion hourly, analysis on new data, assistant cycle nightly), watchdogs, healthchecks, startup reconciliation.

### WP2 — AI Hub integration (4–6 d)
- AI Hub client wrapper (token auth; sync + batch inference APIs; batch status polling; callback handling).
- NER extraction model setup + result persistence.
- Priority model: bootstrap-label corpus → train → batch-validate → record baseline F1.
  - **Review Hub routing is a UI setting, not code** (Feedback Loop: Always / below threshold / Never).
  - **Retraining is a UI action**, seeded from Review-Hub-approved data. No retrain API exists,
    so the "weekly retrain job" becomes a recurring calendar task for the review owner.
  - What the backend automates instead: store each prediction's AI Hub result `_id`, poll those
    ids for `review_status`, and pull verified corrections into `review_feedback`
    (`app/backend/app/services/aihub/review.py`).
- Sentiment model: same lifecycle.
- Model registry table: every model version, its validation metrics, active flag.
- **Inference is single-call with bounded concurrency**, not batch. AI Hub's batch API is a
  five-step file-upload flow (`create/batch` → `upload|insert/batch` → `start/batch` → `batch/find`
  → `results/find-all`) whose per-item ids must be walked back anyway; single calls give us the
  result id per post directly, which is what the Review Hub read-back needs.

### WP3 — Assistant "The Analyst" (3–4 d)
- Configure AI Hub Assistant: instruction (senior data scientist/analyst persona, output contract, evidence requirements), style per Neutrinos brand.
- **The analysis extract is sent inline in the message `text`, not as a knowledge source.**
  Knowledge sources are read-only over the API (`assistant/knowledge/find-all` is the whole
  surface), so an "auto-refreshed per cycle" knowledge source cannot be built. Mapped knowledge
  sources remain for static reference material and are auto-discovered when
  `AIHUB_KNOWLEDGE_SOURCE_IDS` is unset.
- **Phase 1 pulls, it does not receive.** The API Connector requires AI Hub (cloud) to reach our
  backend; on localhost it cannot. `run_assistant_cycle` calls the assistant and pushes the reply
  through the same `/api/insights` gate, so the validation path is identical and the connector can
  be switched on at go-live with no code change.
- `POST /api/insights/ingest` stays as the connector endpoint (schema validation, evidence check,
  versioning, rejection logging) for the hosted phase.
- Insight types shipped: ranked pain points, emerging/rising topics, anomalies (spikes), cross-component relationships/correlations, recommendations with citations.
- Fallback path: if Assistant API fails a cycle, alert + retry; dashboard shows pipeline health.

### WP4 — Database + API layer (2–3 d, overlaps WP2)
- Full schema (§5), aggregate views (per topic/day/week metrics), export endpoints (CSV/JSON/PDF-ready).
- Auth (token + roles: leadership read, engineer read+ops), rate limiting, security headers.

### WP5 — Frontend (5–7 d)
- Neutrinos brand shell: tokens.css mirrored into Tailwind theme; bundled logo (horizontal color on light header, white on Midnight Blue footer); Poppins self-hosted; pill tags/buttons; frame-bracket accents; one accent per view.
- Views:
  1. **Overview** — animated KPI cards (total posts, avg sentiment, high-priority count, active pain points, model confidence levels), ingestion/analysis/assistant pipeline health strip.
  2. **Metrics Explorer** — every stored metric charted over time (post volume, priority distribution, sentiment trend, entity frequency), filterable by category/topic/date/entity.
  3. **Pain Points & Insights** — assistant insights as infographic cards (severity ring, trend arrow, evidence count), expandable to source posts, sentiment mix, related entities.
  4. **Relationships** — visual map (entity↔topic↔sentiment correlation graph) from `insight_relationships`.
  5. **Data Explorer** — searchable post/topic table with per-post extraction/priority/sentiment badges and confidence; evidence drill-down.
  6. **Insight detail** — full recommendation cards with citations to source posts + supporting metrics.
- Export to PDF/print for leadership decks. i18n scaffold retained (en first).

### WP6 — Ops, quality, self-healing (2–3 d, parallel)
- Test suite: pipeline units with fixture corpus, API tests, one end-to-end runnable check (mock Discourse → pipeline → DB → API).
- Self-healing: retry/backoff everywhere, watchdog for stuck runs, Docker healthchecks + auto-restart, orphan reconciliation, degraded-mode staleness banner, failure alerting (log + dashboard + optional webhook).
- Upgraded pinned dependencies; structured logging with run ids.

### WP7 — Observability (2–3 d, parallel) — see `docs/observability-plan.md` (researched, industry-standard)
- Structured JSON logs (structlog) with correlation ids (request_id/run_id/job_id) on every line.
- **All logs retained exactly 5 days**: Loki (retention_period 120h, internal network only) + daily JSONL files rotated at 5 backups as fallback.
- Prometheus metrics (golden signals + pipeline/AI Hub counters), 7d retention.
- **Admin visibility (pe role)**: in-product `/admin` section — log viewer (filter by level/service/run_id, live tail), pipeline run history, audit log screen; plus `audit_logs` DB table (≥90d) for security-relevant events.
- Tracing/alerting/profiling explicitly deferred with revisit triggers (single-host app; correlation ids suffice).

**Total: ~3–4 weeks single-developer equivalent; WP1/WP4/WP5 can run in parallel tracks → ~2–2.5 weeks realistic.**

---

## 5. Database Schema (structured, versioned, complete)

```
forums(id, base_url, name, cursor_state, last_ingested_at)
topics(id, forum_id, discourse_topic_id UNIQUE, title, category, slug,
       created_at, last_posted_at, posts_count, views, like_count, deleted_at)
posts(id, topic_id FK, discourse_post_id UNIQUE, post_number, author_hash,
       body_text, language, created_at, updated_at, ingested_at)
ingestion_state(id, forum_id, since_cursor, pages_done, status, started_at, finished_at)
pipeline_runs(id, kind[ingest|analyze|assistant], status, started_at, finished_at,
              stats JSONB, error, triggered_by[scheduler|manual|retry])
extractions(id, post_id FK, run_id FK, model_version, entity_text, entity_label,
            start_pos, end_pos, confidence, created_at)            -- NER results
priority_results(id, post_id FK, run_id FK, model_version, priority[high|medium|low],
            confidence, reviewed BOOL, reviewer_source[human|none], created_at)
sentiment_results(id, post_id FK, run_id FK, model_version, sentiment[pos|neu|neg],
            intensity REAL, confidence, reviewed BOOL, created_at)
assistant_insights(id, run_id FK, assistant_version, insight_type[pain_point|trend|
            anomaly|relationship|recommendation], title, body, severity,
            priority_rollup, status[active|resolved|superseded],
            valid_from, valid_to, created_at)                      -- append-only
insight_evidence(id, insight_id FK, post_id FK, quote, relevance_note)
insight_relationships(id, insight_id FK, subject_type[entity|topic|category],
            subject_value, relation[correlates_with|drives|spikes_with|...],
            object_type, object_value, strength REAL, evidence_ids JSONB)
model_versions(id, kind[ner|priority|sentiment|assistant], version, ai_hub_model_id,
            metrics JSONB  -- accuracy/precision/recall/f1/confidence from batch validation
            active BOOL, trained_at, training_set_ref)
review_feedback(id, result_type[extraction|priority|sentiment], result_id,
            original_value, corrected_value, reviewed_by, reviewed_at)
job_queue(id, kind, payload JSONB, status[pending|running|done|failed|dead],
            attempts, next_retry_at, locked_by, locked_at, error)
app_config(key, value, updated_at)                                 -- non-secret only
```

Indexes on every FK + (created_at), (priority, confidence), (sentiment), unique on discourse ids. Aggregate views: `daily_topic_metrics`, `weekly_entity_metrics`, `sentiment_trends`. Retention: raw analysis rows kept 18 months, aggregates forever.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| AI Hub model accuracy below gate initially | Provisional-labeling mode on dashboard; active-learning loop closes gap; Claude bootstrap labels are high quality |
| Sentiment = prediction model, not a turnkey product | Same proven classifier mechanics; intensity adds nuance; validated with batch F1 before trusted |
| Assistant output drift/hallucination | Fixed JSON schema + evidence validation gate at `/api/insights`; Review Hub on assistant responses; versioned insights |
| Assistant write access abuse | Connector scoped to single ingest endpoint, token auth, schema-validated, rate-limited, audit-logged |
| AI Hub training data handling | Community posts are internal data; training stays inside Neutrinos AI Hub (governance/audit built in per AI Hub architecture docs) |
| Discourse rate limits | Incremental cursor; admin key; backoff respected |
| Pipeline failure cascade | Stages decoupled via job queue; each independently retryable; dashboard degrades to last-good data with staleness banner |

---

## 7. Sources

- AI Hub overview & use cases (sentiment listed) — https://documentation.neutrinos.com/articles/#!ai-hub/overview
- AI Hub architecture (model types: LLM/SML/Prediction/Extraction=NER; training lifecycle; storage; audit) — https://documentation.neutrinos.com/articles/#!ai-hub/architecture
- Prediction / Text Prediction Model / validation (accuracy, precision, recall, F1, confidence; single+batch) — ai-hub/prediction, ai-hub/text-prediction-model, ai-hub/validate-text-models
- Integrate APIs — Text Prediction & Extraction (sync + batch endpoints, batch status w/ metrics) — ai-hub/integrate-apis-text-prediction, ai-hub/integrate-apis-text-extraction
- Extraction = NER; entity shape {text,label,start} — ai-hub/extraction, ai-hub/itextentity
- Review Hub human-in-the-loop rules — ai-hub/review-hub-text-model, ai-hub/text-extraction-model
- Assistant (instruction, knowledge, style, Review Hub, dashboard) — ai-hub/assistant, ai-hub/work-with-assistant, ai-hub/integrate-api-assistant, ai-hub/review-hub-assistant
- Toolsets: API Connector + MCP Connector; Connectors guide — ai-hub/toolsets, ai-hub/connectors
- Autonomous Mode / assistant harness (future multi-assistant chaining) — ai-hub/autonomous-mode
- Discourse REST API + rate limits — https://meta.discourse.org/t/discourse-rest-api-documentation/22706 , https://meta.discourse.org/t/api-rate-limits/208405
- Prioritization frameworks (impact vs volume) — https://getthematic.com/insights/most-common-complaints-arent-biggest-problems
- MVP audit (basis for rebuild decisions) — `source/source-audit.md`

## 8. Resolved Decisions (2026-09-09, per Jitin)

1. **AI Hub environment — YES, fully develop and test on staging.** Verified against AI Hub docs: the platform is explicitly two-environment — **Sandbox** ("for testing and staging") and **Production** — with identical workflows on both. On Sandbox we can: train/retrain the priority + sentiment + NER models, deploy them to a sandbox deployment unit, run Single + Batch tests with full accuracy/precision/recall/F1 metrics, exercise Review Hub human-in-the-loop flows, create + test the Analyst assistant (dedicated Testing module), and consume everything via inference APIs using sandbox tokens (created per-model in the Tokens page; note tokens are model-specific and sandbox/production scoped). **No production AI Hub access is needed until go-live.** One operational caution: sandbox tokens default to short expiry (30 min / 3 hours / Never options) — for the automated pipeline, create long-lived (Never-expiry) tokens per model and rotate on schedule.
2. **Review ownership — Jitin.** You will work the Review Hub queue (~15 min/day), confirming/correcting low-confidence priority and sentiment predictions; corrections feed the weekly retrain loop.
3. **Cadence — kept as default:** ingestion + analysis hourly; assistant insights nightly.
4. **Deployment — local desktop first.** Phase 1 runs entirely on kurama-core (local Docker/podman stack: postgres + backend + worker + frontend) pointing at the AI Hub staging environment. Phase 2 (go-live) packages the same stack as Docker containers; hosting decision (Neutrinos internal servers vs rented external) is deferred until the product is ready, reviewed, and approved. No code changes between phases — same images, different host + env config.
5. **Auth — none locally, Azure AD (Entra) SSO at go-live.**
   - **Local phase:** no authentication (bind to localhost; the dashboard is private to this desktop).
   - **Production phase:** Azure AD company-portal login. Two roles:
     - **leadership** — dashboard + data analytics only.
     - **pe (Platform Enablement)** — admin role: everything leadership sees, plus a **Settings** sidebar section with: user review (all Azure-linked users who have logged in), database browser (table view), and manual SQL query capability — **read-only enforced at the database connection level** (a dedicated read-only DB role; destructive statements impossible even for admins).
   - **First-login flow:** user signs in via Azure → if a role is already assigned, they land directly on their role's dashboard (sidebar/links per role). If no role assigned, they see a dynamic landing page directing them to contact the Platform Enablement Team for access.
   - **Role management:** pe admins can elevate other users to admin and revoke admin access from within the Settings > Users screen (all changes audit-logged).


---

## 9. AI Hub API contract (verified 2026-09-11) & corrections to v2

Source: documentation.neutrinos.com via the `neutrinos-docs` MCP — `ai-hub/integrate-apis-text-prediction`,
`ai-hub/integrate-apis-text-extraction`, `ai-hub/integrate-api-assistant`,
`ai-hub/classification-text-service-usage`, `ai-hub/extraction-text-service-usage`,
`ai-hub/tokens`, `ai-hub/knowledgeservice`, `ai-hub/review-hub-text-model`, `ai-hub/retrain-model`,
`ai-hub/toolsets`.

### 9.1 Endpoints

Base: `{AIHUB_BASE_URL}/inferenceservice`. Auth: `Authorization: Bearer <token>`.

| Purpose | Method + path |
|---|---|
| Classify one text (priority, sentiment) | `POST /classification/start/text/single` |
| Read one classification result | `GET /classification/results/find-one/{result_id}` |
| Send a classification correction | `POST /classification/results/feedback/{result_id}` |
| Extract entities from one text (NER) | `POST /extraction/start/text/single` |
| Read one extraction result | `GET /extraction/results/find-one/{result_id}` |
| Send an extraction correction | `POST /extraction/results/feedback/{result_id}` |
| Create an assistant conversation | `POST /assistant/conversation/create` |
| Send an assistant message | `POST /assistant/message/create` |
| List the assistant's knowledge sources | `POST /assistant/knowledge/find-all` |

### 9.2 Bodies and responses

```jsonc
// classification / extraction request
{ "text": "..." }
// ...or, for a model trained from a multi-column CSV:
{ "input": { "<training column name>": "..." } }

// classification response (the fields we read)
{ "_id": "683d…", "training_id": "6837…", "review_status": "Pending",
  "output": { "category":   { "name": "high", "confidence": 0.83 },
              "categories": [ { "name": "...", "confidence": 0.0 } ] } }

// extraction response — `result` is preferred, only it carries positions
{ "_id": "6848…",
  "output": { "entities": [ { "entity": "State", "text": "Karnataka", "confidence": 0.99 } ] },
  "result": { "row_0": [ { "entity": "...", "text": "...", "confidence": 0.0,
                           "position": { "start": 0, "end": 9 } },
                         { "summary": [ ... ] } ] } }

// assistant
POST /assistant/conversation/create  { "metadata": {}, "translation_enabled": false } -> { "_id": "..." }
POST /assistant/message/create       { "conversation_id": "...", "text": "...", "sources": ["..."] }
                                     -> { "output": { "text": "..." } }
```

**No request body carries a model, deployment or assistant id.** A token is scoped to one model and
one model version and already binds the deployment (`ai-hub/tokens`), so the token alone selects
what runs. Deployment ids are kept in config for traceability only.

### 9.3 What v2 promised that the API cannot do

| v2 said | Reality | What we do instead |
|---|---|---|
| "wire confidence-threshold routing to Review Hub" (WP2) | Routing is a model-side **Feedback Loop rule set in the AI Hub UI** — Always / below threshold / Never. No API. | One-time UI configuration per model, in the setup walkthrough. |
| "weekly retrain job consuming verified feedback" (WP2) | **Retraining is a UI action** (Versions → Retrain), seeded from Review-Hub-approved rows. No retrain API. | A recurring manual task. The backend keeps `review_feedback` current so the dashboard can show how much data a human has verified. |
| "knowledge source pipeline (auto-refreshed analysis extract per cycle)" (WP3) | `KnowledgeService` **supports listing only**. Sources are created and refreshed in the UI. | The analysis extract goes inline in the assistant message `text`; knowledge sources hold static reference material. |
| "inference via sync + async/batch REST APIs" (§2) | Batch exists but is a five-step file-upload flow, and its results must be walked back to per-item ids. | Single inference with bounded concurrency (`AIHUB_CONCURRENCY`), which also yields the per-post result id the Review Hub read-back needs. |
| "Assistant Toolsets → API Connector pushes insights to `/api/insights`" (§2, WP3) | Requires AI Hub (cloud) to reach our backend. Phase 1 is bound to `127.0.0.1`. | The nightly cycle **pulls**: it calls the assistant and pushes the reply through the same `/api/insights` gate. Connector switches on at go-live, no code change. |

### 9.4 Other corrections

- **D10** — animation is **GSAP**, not Framer Motion (reduced-motion is still honoured via
  `gsap.matchMedia()` and a `prefers-reduced-motion` block in `index.css`).
- **§5 schema** — `priority_results.reviewer_source` was dropped; `reviewed` carries it.
  Added since: `posts.{ner,priority,sentiment}_model_version` (per-stage analysis markers) and
  `{extractions,priority_results,sentiment_results}.aihub_result_id`.
- **D2 backfill** — the first pass now paginates to the end of the feed
  (`DISCOURSE_BACKFILL_MAX_PAGES`); only incremental passes use the small cap, and a truncated pass
  refuses to advance the cursor.
- **§5 retention** ("raw analysis rows kept 18 months") — still not implemented; no retention job exists.

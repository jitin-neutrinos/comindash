# Observability Plan — Community Insights Dashboard

**Status:** v1 plan (research-backed) — implementation lands as observability work package
**Requirement (per Jitin):** all logs captured, retained 5 days, visible to admin (pe role)
**Standard followed:** OpenTelemetry three-signal model (logs, metrics, traces) + structured JSON logging + correlation ids. Sources listed at bottom.

---

## 1. What world-class practice says (and what we adopt)

| Industry standard | Our adoption |
|---|---|
| **Structured JSON logging** — printf logs are unsearchable; JSON with a fixed schema is the baseline | Every log line from backend/worker = one JSON object: `{ts, level, service, run_id, job_id, request_id, msg, ...fields}` |
| **Correlation ids everywhere** — every log carries the ids needed to trace one unit of work end-to-end | `run_id` (pipeline run), `job_id` (queue job), `request_id` (HTTP request). A single dashboard drill-down can show every log line for that analysis run |
| **Log levels with sampling discipline** — keep 100% of ERROR/WARN, sample or disable DEBUG in prod | ERROR/WARN always kept; INFO always kept (our volume is low); DEBUG off by default, toggled via env |
| **Three signals** — logs (why), metrics (what), traces (where) | Logs: mandatory (your requirement). Metrics: lightweight counters (jobs processed/failed/retried, ingest throughput, analysis-sidecar latency). Traces: **deferred** — single-host app, correlation ids give us the same answer without a tracing backend; add OTel tracing only if we later split services |
| **Central aggregation with retention** | Loki (5-day retention enforced at config level) for container logs; database `audit_logs` table for admin-facing operational events; daily JSON log files on disk as the raw permanent-ish layer |
| **Retention is config, not hope** — uniform retention wastes storage | 5 days exactly, enforced twice: Loki `retention_period=120h` + logrotate on file logs (7 daily files max ≈ same window) |
| **Golden signals** (latency, traffic, errors, saturation) for each service | Exposed as `/metrics` (Prometheus format) on backend + worker; scraped by Prometheus |
| **Admin visibility in-product, not just in a separate tool** | pe-role "Logs & Health" screen in the dashboard: query/filter logs, pipeline run history, ingestion stats |

## 2. Architecture (fits our existing compose stack — zero new infra concepts)

```
┌─ backend ─┐  JSON to stdout ─► Docker logging driver ─► Promtail/Promtail-equivalent ─► Loki (120h retention)
├─ worker  ─┤                                                        │
└─ nginx   ─┘                                                        ▼
                                                                     Grafana ◄── (pe admin, optional)
   backend /metrics ─► Prometheus (7d metrics retention) ────────────┘
   worker  /metrics ─┘

   DB tables (already in schema):
     pipeline_runs  — every run: kind, status, timing, stats, error     (kept forever — small)
     job_queue      — every job: attempts, errors, dead-letter status   (kept forever — small)
   NEW:
     audit_logs     — security-relevant events: role changes, settings changes,
                      manual queries, insight-gate rejections           (kept ≥ 90d)

   In-app admin visibility (pe role only):
     /admin/logs        — log viewer: filter by service/level/run_id/request_id/time, live-tail
     /admin/pipeline    — pipeline_runs + job_queue history with error details
     /admin/audit       — audit_logs table
```

### What each admin surface shows
- **Logs screen:** all backend + worker logs, searchable, filterable by level (ERROR/WARN/INFO), service, run_id, request_id, time range. Backed by Loki's HTTP API from the frontend (through the backend as a proxy, pe-token-gated).
- **Pipeline screen:** every ingestion/analysis/assistant run — started/finished, posts processed, issues found, errors, per-stage timing. Already exists as `pipeline_runs`; surfaced in UI.
- **Audit screen:** who changed what (future Azure-SSO era: user identity; local era: "local-admin").

## 3. Implementation details

### 3.1 Structured logging (backend + worker)
- `structlog` (industry standard for Python JSON logging) with a small wrapper in `app/logging_config.py`:
  - contextvars for `request_id` / `run_id` / `job_id` — set by FastAPI middleware / worker job handler, automatically attached to every log line in that context
  - JSON renderer to stdout (Docker captures); level via `LOG_LEVEL` env (default INFO)
- FastAPI middleware: assign `request_id` (uuid4) per request, echo it back as `X-Request-ID` response header, log method/path/status/duration_ms at INFO, exceptions at ERROR with traceback
- Worker: sets `run_id`/`job_id` context per job; job start/finish/fail/retry lines at INFO/WARN/ERROR
- Analysis sidecar: one INFO line per call (`{provider: sidecar, stage, latency_ms, status}`), ERROR on failure — this doubles as the model cost/latency audit trail; the GLM assistant cycle logs per-call token usage into the `insight_runs` ledger
- Never log: API keys, tokens, post body content (ids only), user PII

### 3.2 Log shipping + retention (5 days)
- **Loki** in single-binary mode added to docker-compose:
  - `retention_period: 120h` (5 days) with the compactor retention enabled — enforced deletion after 120h
  - Only reachable on the internal compose network (no published port)
- **Promtail** (or Grafana Alloy in fleet mode — final choice at implementation) reads all container logs via the docker socket and ships to Loki with labels: `service` (backend/worker/frontend), `level`
- **File fallback layer:** backend/worker also write daily JSON lines to the `logs/` volume (`logs/backend-2026-09-09.jsonl`), rotated by `TimedRotatingFileHandler(when=midnight, backupCount=5)` — survives even if Loki is down; also what the in-app viewer reads in "minimal mode" (below)

### 3.3 Metrics (lightweight)
- `prometheus-fastapi-instrumentator` on the backend: HTTP request count/latency histogram per route (route templates only — no raw paths, per cardinality rules)
- Custom counters: `jobs_processed_total{kind,status}`, `job_retry_total`
- **Prometheus** container, 15s scrape, 7-day retention (metrics are cheap; 5-day rule applied to logs only, as specified)
- Worker exposes the same `/metrics` via a tiny internal HTTP server

### 3.4 Admin surfaces (in-product, pe role)
- `GET /api/admin/logs?service=&level=&run_id=&request_id=&since=&until=` — backend proxies Loki query API (`/loki/api/v1/query_range`), pe-token gated. Falls back to reading the `logs/*.jsonl` files if Loki is down (same response shape) — self-healing visibility
- `GET /api/admin/pipeline` — pipeline_runs + failed jobs, already captured
- Frontend: `/admin` section (visible only to pe role) — Logs screen (filter + live tail + level color coding), Pipeline screen, Audit screen
- Local (pre-SSO) phase: `/admin/*` bound to localhost only — no auth needed (matches our no-auth-local decision); SSO phase: pe role gate

### 3.5 Auditable events (new `audit_logs` table)
`audit_logs(id, ts, actor, action, target, detail JSONB)` — written on: insight-gate rejections, manual pipeline triggers, admin queries (sampled), settings changes, (future) role elevations/revocations, login events. Retained ≥ 90 days (audit ≠ debug logs — the 5-day rule applies to operational logs).

## 4. Explicitly deferred (with trigger to revisit)
| Deferred | Why | Revisit when |
|---|---|---|
| Distributed tracing (Tempo/Jaeger + OTel SDK) | Single host, 3 services; correlation ids already answer "where did this run go wrong" | If we split services across hosts |
| Alertmanager / paging | No on-call yet; dashboard StaleBanner + health strip surface failures | Go-live with real users |
| Pyroscope/profiling | No performance problems to hunt yet | Sustained latency issues |

## 5. Work package

**WP7 — Observability (2–3 d, parallel-safe):**
1. `logging_config.py` + structlog + contextvars middleware (backend) and worker job-context logging
2. Loki + Promtail + Prometheus added to `docker-compose.yml` (internal network only), retention configs checked in
3. `/metrics` endpoints + custom counters
4. `audit_logs` table (Alembic migration) + write points
5. `/api/admin/logs` + `/api/admin/pipeline` (Loki proxy with jsonl fallback) + frontend `/admin` screens (pe-gated)
6. Tests: log schema shape, retention config sanity (assert 120h in checked-in Loki config), admin endpoints auth behavior

## 6. Sources
- OpenTelemetry observability primer (signals, correlation) — https://opentelemetry.io/docs/concepts/observability-primer/
- Three pillars + sampling discipline (ERROR/WARN never sampled; trace_id in every line) — https://backendbytes.com/articles/observability-metrics-logs-traces/ , https://oneuptime.com/blog/post/2026-02-06-opentelemetry-traces-vs-metrics-vs-logs/view
- Self-hosted Grafana/Loki/Prometheus compose patterns (Loki label-only indexing ≈ 10x cheaper than full-text) — https://datazone.de/en/aktuelles/grafana-prometheus-loki-stack-self-hosted , https://services.org.pl/build-your-own-docker-based-observability-stack
- Prometheus cardinality rules (route templates, not raw paths) — https://backendbytes.com/articles/observability-metrics-logs-traces/
- Log retention/cost practice — https://www.youngju.dev/blog/culture/2026-04-15-observability-complete-guide-metric-log-trace-opentelemetry-ebpf-slo-deep-dive-guide-2025.en
- Python structured logging (TimedRotatingFileHandler patterns) — https://betterstack.com/community/guides/logging/logging-with-fastapi

#!/usr/bin/env python3
"""DB-backed job queue worker for the Community Insights Dashboard.

Claims pending jobs from the ``job_queue`` table using the standard
``SELECT ... FOR UPDATE SKIP LOCKED`` pattern (expressed as a single
atomic ``UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)``
statement) and executes them.

Job kinds
---------
ingest         -> backend app.services.ingestion (incremental Discourse pull)
analyze        -> backend app.services.aggregator / app.services.analysis.* (NER,
                  priority, sentiment, rollups; stub mode)
assistant_cycle -> backend app.services.analysis.assistant (nightly analyst
                  cycle; skip mode with no assistant backend configured)

Backend coupling
----------------
Handlers import backend modules *inside* the handler (never at module
import time) so this worker boots cleanly while the backend tree is still
landing. The backend repo directory is prepended to ``sys.path``:

* ``BACKEND_PATH`` env var (colon-separated, checked first), default
  ``/app/backend`` (container layout);
* ``<repo>/app/backend`` — resolved relative to this file (local/dev and
  the validation harness layout).

If a backend module is not importable yet, the job fails with a clear
``BackendUnavailable`` error and is retried with exponential backoff —
once the backend lands, queued jobs succeed with zero code change.

Retry policy
------------
Exponential backoff (``WORKER_BACKOFF_BASE_S`` * 2**(attempts-1), capped
at ``WORKER_BACKOFF_CAP_S``). After ``WORKER_MAX_ATTEMPTS`` attempts the
job is moved to ``dead`` (dead-letter) for inspection.

Usage
-----
    python worker.py             # continuous loop (default)
    python worker.py --once      # drain currently-claimable jobs, then exit
    python worker.py --smoke     # boot, connect-or-skip DB, exit 0

Every log line is a single JSON object with at least ``event`` plus the
active ``job_id`` / ``kind`` where applicable. The pipeline_runs row for a
job is opened and closed by the backend service function the handler calls —
the worker deliberately does not create one.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import inspect
import json
import structlog
from prometheus_client import Counter, start_http_server

JOBS_PROCESSED = Counter('jobs_processed_total', 'Jobs processed', ['kind', 'status'])
JOB_RETRIES = Counter('job_retry_total', 'Job retries', ['kind'])

from app.logging_config import setup_logging
setup_logging("worker")
logger = structlog.get_logger("worker")

import os
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncpg

WORKER_DIR = Path(__file__).resolve().parent
APP_ROOT = WORKER_DIR.parent

# --- Alerting (production hardening 2026-09-28) -------------------------------
# Worker-side failures must reach a human without anyone opening a dashboard.
# ntfy (host 127.0.0.1:8086 from the worker container's perspective: the
# compose gateway) takes a single POST — no client lib, no queue dependency,
# and failure to alert must NEVER break job processing.
NTFY_URL = os.environ.get("NTFY_URL", "http://172.22.0.1:8086/")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "comindash-alerts")
NTFY_TOKEN = os.environ.get("NTFY_TOKEN", "")  # ntfy runs auth-default deny-all


async def alert(title: str, body: str, tags: str = "warning") -> None:
    """Fire-and-forget push alert. Best-effort: log on failure, never raise."""
    import urllib.request
    try:
        headers = {
            "Title": title,
            "Tags": tags,
            "Priority": "high" if "critical" in tags else "default",
        }
        if NTFY_TOKEN:
            headers["Authorization"] = f"Bearer {NTFY_TOKEN}"
        req = urllib.request.Request(
            NTFY_URL + NTFY_TOPIC,
            data=(body or title).encode(),
            headers=headers,
            method="POST",
        )
        def _post():
            with urllib.request.urlopen(req, timeout=3) as r:
                return r.status
        await asyncio.to_thread(_post)
    except Exception as exc:  # noqa: BLE001 — alerting must never break jobs
        log("alert_failed", level="warning", title=title, error=str(exc)[:200])


def _alert_digest(error: str, kind: str) -> str:
    """Collapse repeated identical failures into one alert every 30 min."""
    now = time.time()
    key = f"{kind}:{error[:120]}"
    state = _ALERT_STATE
    state["last"] = now
    prev = state.get(key)
    state[key] = now
    # keep the map bounded
    if len(state) > 64:
        for k in list(state.keys())[:-1]:
            if k != "last":
                del state[k]
    return "dedupe_new" if (prev is None or now - prev > 1800) else "dedupe_skip"


_ALERT_STATE: dict = {}

# ---------------------------------------------------------------------------


def _backend_paths() -> list[str]:
    paths = [p for p in os.environ.get("BACKEND_PATH", "/app/backend").split(":") if p]
    paths.append(str(APP_ROOT / "backend"))
    return paths


for _p in _backend_paths():
    if Path(_p).exists() and _p not in sys.path:
        sys.path.insert(0, _p)

# ---------------------------------------------------------------------------
# Configuration (env only, consistent with backend pydantic-settings style)
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+asyncpg://insights:insights_local@localhost:5433/insights"
)
POLL_INTERVAL_S = float(os.environ.get("WORKER_POLL_INTERVAL_S", "5"))
IDLE_BACKOFF_S = float(os.environ.get("WORKER_IDLE_BACKOFF_S", "30"))
MAX_ATTEMPTS = int(os.environ.get("WORKER_MAX_ATTEMPTS", "5"))
BACKOFF_BASE_S = float(os.environ.get("WORKER_BACKOFF_BASE_S", "30"))
BACKOFF_CAP_S = float(os.environ.get("WORKER_BACKOFF_CAP_S", "3600"))
STALE_LOCK_MINUTES = float(os.environ.get("WORKER_STALE_LOCK_MINUTES", "30"))
WORKER_ID = os.environ.get("WORKER_ID", f"worker-{os.getpid()}")
HEARTBEAT_PATH = os.environ.get("WORKER_HEARTBEAT_PATH", "/tmp/worker-heartbeat")

# The backend service functions open and close their own pipeline_runs row (it
# is the row the extractions/priority/sentiment results are keyed to). The
# worker must NOT open a second one: that produced two rows per job, half of
# them with NULL stats, and made /api/health's "last run" a coin flip.


def _dsn(url: str) -> str:
    """Convert a SQLAlchemy-style URL to one asyncpg accepts."""
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def log(event: str, level: str = "info", **fields: Any) -> None:
    func = getattr(logger, level.lower(), logger.info)
    func(event, worker_id=WORKER_ID, **fields)


def touch_heartbeat() -> None:
    try:
        Path(HEARTBEAT_PATH).touch()
    except OSError:  # pragma: no cover - read-only fs in some sandboxes
        pass


# ---------------------------------------------------------------------------
# Backend handler plumbing
# ---------------------------------------------------------------------------


class BackendUnavailable(Exception):
    """Backend service module/callable is not importable (yet)."""


async def _invoke(fn: Any, payload: dict[str, Any]) -> Any:
    """Call a backend callable with the payload, defensively.

    Keyword arguments are filtered to the callable's declared parameters.
    Sync callables are run in a thread so async paths never block.
    """
    try:
        sig = inspect.signature(fn)
        accepts_kwargs = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        named = {name: p for name, p in sig.parameters.items()
                 if p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)}
        kwargs = {k: v for k, v in payload.items() if accepts_kwargs or k in named} if payload else {}
        for name, p in named.items():
            if name not in kwargs and p.default is inspect.Parameter.empty:
                kwargs[name] = payload.get(name)  # surfaces a clear TypeError if truly required
    except (TypeError, ValueError):
        kwargs = {}
    if inspect.iscoroutinefunction(fn):
        return await fn(**kwargs)
    return await asyncio.to_thread(fn, **kwargs)


async def _call_first_available(candidates: list[tuple[str, list[str]]], payload: dict[str, Any]) -> Any:
    tried: list[str] = []
    for module_name, fn_names in candidates:
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:  # noqa: BLE001 - backend may be absent/partial
            tried.append(f"import {module_name}: {type(exc).__name__}: {exc}")
            continue
        for name in fn_names:
            fn = getattr(module, name, None)
            if fn is None:
                tried.append(f"{module_name}.{name}: not found")
                continue
            log("backend_handler_selected", module=module_name, function=name)
            return await _invoke(fn, payload)
    raise BackendUnavailable(
        "no backend service callable available yet (backend landing in parallel); tried: " + "; ".join(tried)
    )


async def handle_ingest(job_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    log("handler_start", job_id=job_id, kind="ingest")
    stats = await _call_first_available(
        [
            ("app.services.ingestion", ["run_ingest", "ingest_forum", "ingest_since", "ingest", "run"]),
            ("app.services.discourse", ["run_ingest", "ingest"]),
        ],
        payload,
    )
    
    try:
        import importlib
        mod = importlib.import_module("app.services.jobs")
        job = await mod.enqueue_assistant_on_freshness(
            stats if isinstance(stats, dict) else {}, triggered_by=f"freshness:{job_id}")
        if job: 
            log("assistant_cycle_enqueued_on_freshness", job_id=job.id, posts_new=(stats if isinstance(stats, dict) else {}).get("posts_new"))
    except Exception as exc:  # hook must never fail the ingest job
        log("freshness_hook_failed", level="warning", error=str(exc)[:200])

    return {"stats": stats if isinstance(stats, dict) else {"result": str(stats)}}


async def handle_analyze(job_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    log("handler_start", job_id=job_id, kind="analyze")
    stats = await _call_first_available(
        [
            ("app.services.aggregator", ["run_aggregation", "aggregate", "run", "run_analysis"]),
            ("app.services.analysis.extraction", ["run_extraction", "extract", "run"]),
            ("app.services.analysis.priority", ["run_priority", "run"]),
            ("app.services.analysis.sentiment", ["run_sentiment", "run"]),
            ("app.services", ["run_analysis", "analyze"]),
        ],
        payload,
    )
    return {"stats": stats if isinstance(stats, dict) else {"result": str(stats)}}


async def handle_assistant_cycle(job_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    log("handler_start", job_id=job_id, kind="assistant_cycle")
    stats = await _call_first_available(
        [
            ("app.services.analysis.assistant", ["run_assistant_cycle", "run_cycle", "run"]),
            ("app.services", ["run_assistant_cycle"]),
        ],
        payload,
    )
    return {"stats": stats if isinstance(stats, dict) else {"result": str(stats)}}


async def handle_maintenance(job_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Retention purges + storage guard (services/retention.py, prod 2026-09-28)."""
    log("handler_start", job_id=job_id, kind="maintenance")
    stats = await _call_first_available(
        [
            ("app.services.retention", ["run_maintenance", "run"]),
        ],
        payload,
    )
    result = stats if isinstance(stats, dict) else {"result": str(stats)}
    # Storage guard: alert when the volume hosting Postgres crosses critical.
    storage: Any = result.get("storage")
    if isinstance(storage, dict) and storage.get("state") == "critical":
        await alert(
            "Storage critical: pipeline volume nearly full",
            f"Volume {storage.get('path')} at {storage.get('used_pct')}% used, "
            f"{storage.get('free_gb')}GB free. Ingest may fail soon.",
            tags="floppy_disk,critical",
        )
    return {"stats": result}


HANDLERS = {
    "ingest": handle_ingest,
    "analyze": handle_analyze,
    "assistant_cycle": handle_assistant_cycle,
    "maintenance": handle_maintenance,
}

# ---------------------------------------------------------------------------
# Queue SQL (asyncpg, plain SQL — no dependency on backend ORM models)
# ---------------------------------------------------------------------------

CLAIM_JOB_SQL = """
UPDATE job_queue
SET status = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1
WHERE id = (
    SELECT id FROM job_queue
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND kind = ANY($2::text[])
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, kind, COALESCE(payload, '{}'::jsonb) AS payload, attempts
"""

RECONCILE_STALE_SQL = """
UPDATE job_queue
SET status = 'pending', locked_by = NULL, locked_at = NULL, next_retry_at = now(),
    error = COALESCE(error, '') || ' [requeued: stale lock from previous worker]'
WHERE status = 'running' AND locked_at < now() - ($1::text || ' minutes')::interval
RETURNING id
"""

COMPLETE_JOB_SQL = """
UPDATE job_queue
SET status = 'done', error = NULL, next_retry_at = NULL, locked_by = NULL
WHERE id = $1
"""

FAIL_JOB_SQL = """
UPDATE job_queue
SET status = CASE WHEN attempts >= $2 THEN 'dead' ELSE 'pending' END,
    error = $3,
    next_retry_at = CASE WHEN attempts >= $2 THEN NULL
                         ELSE now() + make_interval(secs => $4) END,
    locked_by = NULL
WHERE id = $1
RETURNING status
"""




async def connect_with_retry(conninfo: str, attempts: int = 3, delay_s: float = 2.0) -> asyncpg.Connection:
    last_exc: Exception | None = None
    for _ in range(attempts):
        try:
            return await asyncpg.connect(conninfo, timeout=10)
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            await asyncio.sleep(delay_s)
    raise last_exc  # type: ignore[misc]


async def reconcile_stale_locks(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch(RECONCILE_STALE_SQL, str(STALE_LOCK_MINUTES))
    for row in rows:
        log("job_requeued_stale_lock", job_id=row["id"])
    return len(rows)


def backoff_delay_s(attempts: int) -> float:
    return min(BACKOFF_BASE_S * (2 ** max(attempts - 1, 0)), BACKOFF_CAP_S)


async def execute_job(conn: asyncpg.Connection, job_id: int, kind: str, payload: dict[str, Any], attempts: int) -> None:
    log("job_started", job_id=job_id, kind=kind, attempts=attempts)
    handler = HANDLERS.get(kind)
    if handler is None:
        await fail_job(conn, job_id, kind, attempts, f"unknown job kind: {kind!r}")
        return
    try:
        result = await handler(job_id, payload)
    except BackendUnavailable as exc:
        await fail_job(conn, job_id, kind, attempts, str(exc))
    except Exception as exc:  # noqa: BLE001 - job isolation: one bad job must not kill the loop
        log("job_error", level="error", job_id=job_id, kind=kind,
            error=str(exc), traceback=traceback.format_exc(limit=6))
        await fail_job(conn, job_id, kind, attempts, f"{type(exc).__name__}: {exc}")
    else:
        await conn.execute(COMPLETE_JOB_SQL, job_id)
        JOBS_PROCESSED.labels(kind=kind, status="done").inc()
        log("job_done", job_id=job_id, kind=kind, stats=result.get("stats"))


async def fail_job(conn: asyncpg.Connection, job_id: int, kind: str, attempts: int, error: str) -> None:
    status = await conn.fetchval(FAIL_JOB_SQL, job_id, MAX_ATTEMPTS, error[:2000], backoff_delay_s(attempts))
    level = "warning" if status == "pending" else "error"
    if status == "pending":
        JOB_RETRIES.labels(kind=kind).inc()
    JOBS_PROCESSED.labels(kind=kind, status="failed").inc()
    log("job_failed", level=level, job_id=job_id, kind=kind, attempts=attempts,
        next_status=status, retry_in_s=backoff_delay_s(attempts) if status == "pending" else None,
        error=error)
    # Production alerting: retrying failures alert at WARN once per 30 min per
    # unique error; a job going DEAD (exhausted retries) always alerts at HIGH.
    if status == "dead":
        await alert(
            "Job dead-lettered: pipeline needs attention",
            f"Job #{job_id} ({kind}) exhausted {attempts} attempts.\n{error[:400]}",
            tags="skull,critical",
        )
    elif _alert_digest(error, kind) == "dedupe_new":
        await alert(
            f"Job failing (attempt {attempts}/{MAX_ATTEMPTS}): {kind}",
            f"Job #{job_id} ({kind}) failed and will retry.\n{error[:400]}",
            tags="warning",
        )


# ---------------------------------------------------------------------------
# Loops
# ---------------------------------------------------------------------------


async def drain_once(conn: asyncpg.Connection, idle_stop: bool = False) -> int:
    """Claim and execute jobs until none are immediately claimable."""
    processed = 0
    kinds = list(HANDLERS)
    while True:
        row = await conn.fetchrow(CLAIM_JOB_SQL, WORKER_ID, kinds)
        if row is None:
            break
        job_id, kind = row["id"], row["kind"]
        payload = json.loads(row["payload"]) if isinstance(row["payload"], str) else dict(row["payload"] or {})
        if not isinstance(payload, dict):
            payload = {"payload": payload}
        await execute_job(conn, job_id, kind, payload, row["attempts"])
        processed += 1
        touch_heartbeat()
    if idle_stop:
        log("drain_idle")
    return processed


async def run_loop() -> int:
    start_http_server(8000)
    log("worker_start", database_url_host=_dsn(DATABASE_URL).split("@")[-1].split("/")[0],
        max_attempts=MAX_ATTEMPTS, poll_interval_s=POLL_INTERVAL_S,
        idle_backoff_s=IDLE_BACKOFF_S)
    conn = await connect_with_retry(_dsn(DATABASE_URL), attempts=30, delay_s=2.0)
    log("db_connected")
    await reconcile_stale_locks(conn)
    idle_polls = 0
    while True:
        processed = 0
        try:
            processed = await drain_once(conn)
        except asyncpg.PostgresError as exc:
            log("db_error", level="error", error=str(exc))
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = await connect_with_retry(_dsn(DATABASE_URL), attempts=30, delay_s=2.0)
            log("db_reconnected")
            await reconcile_stale_locks(conn)
        touch_heartbeat()
        # Idle backoff (db-hit audit): a fully idle worker claimed jobs every
        # 5s around the clock (~15k claims/21h). Busy → poll fast; idle →
        # ramp to IDLE_BACKOFF_S. Any processed job resets the ramp.
        if processed:
            idle_polls = 0
            await asyncio.sleep(POLL_INTERVAL_S)
        else:
            idle_polls += 1
            delay = min(POLL_INTERVAL_S * idle_polls, IDLE_BACKOFF_S)
            await asyncio.sleep(delay)


async def run_smoke() -> int:
    """Boot check: connect if possible, report, always exit 0 (connect-or-skip)."""
    log("smoke_start")
    try:
        conn = await asyncpg.connect(_dsn(DATABASE_URL), timeout=10)
    except Exception as exc:  # noqa: BLE001
        log("smoke_db_skip", level="warning", reason=f"database not reachable: {type(exc).__name__}: {exc}")
        print("[SKIP] worker smoke: database not reachable — worker boot OK, DB connect skipped")
        return 0
    try:
        try:
            n = await conn.fetchval("SELECT count(*) FROM job_queue")
            log("smoke_ok", pending_done_dead_jobs=n)
            print(f"[ OK ] worker smoke: connected, job_queue reachable ({n} rows)")
        except asyncpg.UndefinedTableError:
            log("smoke_db_skip", level="warning", reason="job_queue table not created yet (migrations pending)")
            print("[SKIP] worker smoke: connected, but job_queue table not created yet — skipped")
        touch_heartbeat()
        return 0
    finally:
        await conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Community Insights Dashboard job queue worker")
    parser.add_argument("--once", action="store_true", help="drain claimable jobs then exit")
    parser.add_argument("--smoke", action="store_true", help="boot + connect-or-skip check, exit 0")
    args = parser.parse_args()
    try:
        if args.smoke:
            return asyncio.run(run_smoke())
        if args.once:
            return asyncio.run(_once())
        return asyncio.run(run_loop())
    except KeyboardInterrupt:
        log("worker_stopped", reason="keyboard interrupt")
        return 0


async def _once() -> int:
    conn = await connect_with_retry(_dsn(DATABASE_URL), attempts=3, delay_s=2.0)
    try:
        await reconcile_stale_locks(conn)
        processed = await drain_once(conn, idle_stop=True)
        log("once_complete", processed=processed)
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(main())

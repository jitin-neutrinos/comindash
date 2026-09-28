"""Data retention + storage guard (production hardening, 2026-09-28).

The observability plan (docs/observability-plan.md §5) promised retention
windows; nothing executed them. This service is that executor, run as a
``maintenance`` job through the same DB queue as everything else (retry +
dead-letter semantics for free), plus a storage guard reporting disk state
for the volume hosting Postgres (the original production incident on this
stack: db_data filled the disk).

Policies (env-tunable):
  - job_queue done rows   : age out via locked_at after 14 days, plus a hard
                            cap of 2000 kept (backend-completed rows have
                            NULL locked_at, so age alone cannot reach them)
  - job_queue dead rows   : keep 30 days (inspection window)
  - pipeline_runs         : keep 90 days
  - audit_logs            : keep 180 days
  - posts/extractions/results: NOT purged here (business data; the 18-month
                            analysis-row policy is a deliberate human
                            decision, surfaced on the Settings page instead
                            of silently deleted by a cron)

Self-check: ``python -m app.services.retention`` (run from app/backend).
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Job, JobStatus, PipelineRun
from app.services.database_session import get_run_session

logger = logging.getLogger("retention")

JOB_DONE_RETENTION_DAYS = int(os.environ.get("JOB_DONE_RETENTION_DAYS", "14"))
JOB_DEAD_RETENTION_DAYS = int(os.environ.get("JOB_DEAD_RETENTION_DAYS", "30"))
JOB_DONE_KEEP_CAP = int(os.environ.get("JOB_DONE_KEEP_CAP", "2000"))
RUN_RETENTION_DAYS = int(os.environ.get("RUN_RETENTION_DAYS", "90"))
AUDIT_RETENTION_DAYS = int(os.environ.get("AUDIT_RETENTION_DAYS", "180"))
# Fraction of the filesystem hosting the Postgres volume. Above warn the
# command centre shows amber; above critical, red + a hold-off signal the
# ingest side can honour. Defaults are generous; tune per deployment.
STORAGE_WARN_PCT = float(os.environ.get("STORAGE_WARN_PCT", "80"))
STORAGE_CRIT_PCT = float(os.environ.get("STORAGE_CRIT_PCT", "92"))


async def purge_job_queue(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    out: dict[str, int] = {}
    done_cutoff = now - timedelta(days=JOB_DONE_RETENTION_DAYS)
    r = await session.execute(
        delete(Job).where(
            Job.status == JobStatus.done,
            Job.locked_at.isnot(None),
            Job.locked_at < done_cutoff,
        )
    )
    out["job_done"] = r.rowcount or 0
    dead_cutoff = now - timedelta(days=JOB_DEAD_RETENTION_DAYS)
    r = await session.execute(
        delete(Job).where(
            Job.status == JobStatus.dead,
            Job.locked_at.isnot(None),
            Job.locked_at < dead_cutoff,
        )
    )
    out["job_dead"] = r.rowcount or 0
    # Hard cap by id regardless of timestamps: backend-completed jobs have
    # NULL locked_at, so age alone cannot bound the table.
    r = await session.execute(text(
        "DELETE FROM job_queue WHERE status = 'done' AND id <= ("
        " SELECT COALESCE(max(id), 0) - :cap FROM job_queue WHERE status = 'done')"
    ), {"cap": JOB_DONE_KEEP_CAP})
    out["job_done_cap_trim"] = r.rowcount or 0
    await session.commit()
    return out


async def purge_pipeline_runs(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=RUN_RETENTION_DAYS)
    r = await session.execute(
        delete(PipelineRun).where(
            PipelineRun.status != "running",
            (PipelineRun.finished_at.is_(None)) | (PipelineRun.finished_at < cutoff),
        )
    )
    n = r.rowcount or 0
    await session.commit()
    return {"pipeline_runs": n}


async def purge_audit_logs(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=AUDIT_RETENTION_DAYS)
    r = await session.execute(delete(AuditLog).where(AuditLog.ts < cutoff))
    n = r.rowcount or 0
    await session.commit()
    return {"audit_logs": n}


def storage_status(path: str = "/") -> dict[str, Any]:
    """Free-space check for the filesystem hosting Postgres (db_data volume)."""
    usage = shutil.disk_usage(path)
    pct = usage.used / usage.total * 100.0
    state = "ok" if pct < STORAGE_WARN_PCT else ("warn" if pct < STORAGE_CRIT_PCT else "critical")
    return {
        "path": path,
        "total_gb": round(usage.total / 1e9, 1),
        "free_gb": round(usage.free / 1e9, 1),
        "used_pct": round(pct, 1),
        "state": state,
    }


async def run_maintenance(session: AsyncSession | None = None) -> dict[str, Any]:
    """One maintenance pass: all purges + a storage report. Caller (worker
    handler) wraps this in the queue's retry policy. Opens its own DB session
    when invoked without one (the worker's generic handler passes only payload
    keys — same contract as every other service entry point).

    Retention windows first honour the ops config in ``app_config`` (set from
    the Settings page), falling back to env/defaults — so the page can tighten
    or loosen retention without a redeploy.
    """
    from app.models import AppConfig

    if session is None:
        async with get_run_session() as s:
            return await run_maintenance(s)

    try:
        row = await session.get(AppConfig, "ops")
        if row is not None and isinstance(row.value, dict):
            v = row.value
            globals()["JOB_DONE_RETENTION_DAYS"] = int(v.get("job_done_retention_days", JOB_DONE_RETENTION_DAYS))
            globals()["RUN_RETENTION_DAYS"] = int(v.get("run_retention_days", RUN_RETENTION_DAYS))
            globals()["AUDIT_RETENTION_DAYS"] = int(v.get("audit_retention_days", AUDIT_RETENTION_DAYS))
    except Exception:  # noqa: BLE001 — ops row missing/malformed must not block cleanup
        pass

    stats: dict[str, Any] = {}
    stats.update(await purge_job_queue(session))
    stats.update(await purge_pipeline_runs(session))
    stats.update(await purge_audit_logs(session))
    stats["storage"] = storage_status()
    logger.info("maintenance pass: %s", stats)
    return stats


def _self_check() -> None:
    from pathlib import Path

    # storage math against a real filesystem must land in a known state set
    s = storage_status(str(Path(__file__).resolve().parent))
    assert 0 <= s["used_pct"] <= 100
    assert s["state"] in ("ok", "warn", "critical")
    assert s["free_gb"] <= s["total_gb"]
    # policy math: cutoffs must be in the past
    now = datetime.now(timezone.utc)
    assert now - timedelta(days=JOB_DONE_RETENTION_DAYS) < now
    assert now - timedelta(days=RUN_RETENTION_DAYS) < now
    assert STORAGE_WARN_PCT < STORAGE_CRIT_PCT
    print("retention self-check OK")


if __name__ == "__main__":
    _self_check()

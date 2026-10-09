"""APScheduler wiring: hourly ingestion+analysis, nightly assistant cycle.

The scheduler does NOT run the pipeline itself — it enqueues jobs into the
DB-backed queue (services/jobs.py); the worker container claims and executes
them. This keeps the API process responsive and gives retry/dead-letter
semantics for free.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import func, select

from app.config import get_settings
from app.models import Job, JobStatus, PipelineRun, RunKind, RunStatus
from app.services.database_session import get_run_session
from app.services import jobs

logger = structlog.get_logger("scheduler")


async def enqueue_ingest_and_analyze() -> None:
    async with get_run_session() as session:
        await jobs.enqueue(session, "ingest", {"triggered_by": "scheduler"})
        await jobs.enqueue(session, "analyze", {"triggered_by": "scheduler"})
    logger.info("scheduler: enqueued ingest + analyze")


async def enqueue_assistant_cycle() -> None:
    async with get_run_session() as session:
        await jobs.enqueue(session, "assistant_cycle", {"triggered_by": "scheduler"})
    logger.info("scheduler: enqueued assistant_cycle")


async def enqueue_maintenance() -> None:
    """Daily retention purge + storage guard (prod hardening 2026-09-28)."""
    async with get_run_session() as session:
        await jobs.enqueue(session, "maintenance", {"triggered_by": "scheduler"})
    logger.info("scheduler: enqueued maintenance")


async def catch_up_missed_assistant_cycle() -> None:
    """Boot-time catch-up: the daily assistant cron has no memory across
    restarts, so a backend outage spanning the 02:00-UTC slot silently skips
    the analyst for a full day (seen 2026-10-09: backend down 23:36-06:59,
    cycle missed, freshness hook silent because the forum was quiet). If the
    last completed assistant run predates the most recent slot, enqueue one.
    Idempotent: pending/running guard + jobs.enqueue dedupe."""
    s = get_settings()
    now = datetime.now(timezone.utc)
    last_slot = now.replace(
        hour=s.assistant_cycle_hour, minute=0, second=0, microsecond=0
    )
    if now < last_slot:
        last_slot -= timedelta(days=1)

    async with get_run_session() as session:
        queued = await session.execute(
            select(func.count())
            .select_from(Job)
            .where(
                Job.kind == "assistant_cycle",
                Job.status.in_([JobStatus.pending, JobStatus.running]),
            )
        )
        if (queued.scalar() or 0) > 0:
            logger.info("catchup: assistant_cycle already queued, skipping")
            return
        last_done = await session.execute(
            select(PipelineRun.finished_at)
            .where(
                PipelineRun.kind == RunKind.assistant,
                PipelineRun.status == RunStatus.done,
            )
            .order_by(PipelineRun.finished_at.desc().nullslast())
            .limit(1)
        )
        last_finished = last_done.scalar_one_or_none()
        if last_finished is not None and last_finished >= last_slot:
            logger.info(
                "catchup: assistant cycle fresh (last done %s >= slot %s), skipping",
                last_finished,
                last_slot,
            )
            return
        await jobs.enqueue(
            session, "assistant_cycle", {"triggered_by": "catchup:boot"}
        )
    logger.info(
        "catchup: missed assistant cycle enqueued (last done %s, slot %s)",
        last_finished,
        last_slot,
    )


def create_scheduler() -> AsyncIOScheduler:
    s = get_settings()
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        enqueue_ingest_and_analyze,
        "interval",
        minutes=s.ingest_interval_minutes,
        id="ingest_and_analyze",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        enqueue_assistant_cycle,
        "cron",
        hour=s.assistant_cycle_hour,
        minute=0,
        id="assistant_cycle",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        enqueue_maintenance,
        "cron",
        hour=3,
        minute=30,
        id="maintenance",
        max_instances=1,
        coalesce=True,
    )
    return scheduler

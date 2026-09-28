"""APScheduler wiring: hourly ingestion+analysis, nightly assistant cycle.

The scheduler does NOT run the pipeline itself — it enqueues jobs into the
DB-backed queue (services/jobs.py); the worker container claims and executes
them. This keeps the API process responsive and gives retry/dead-letter
semantics for free.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import get_settings
from app.services.database_session import get_run_session
from app.services import jobs

logger = logging.getLogger("scheduler")


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

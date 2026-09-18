"""DB-backed job queue: enqueue/claim/complete/fail, retry with backoff,
watchdog + startup reconciliation (requeue stale ``running`` locks left by a
dead worker). The worker loop itself lives in app-worker/worker.py; these are
the service-side primitives the backend (scheduler, routes) uses."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobStatus

logger = logging.getLogger("jobs")

MAX_ATTEMPTS = 5
BACKOFF_BASE_S = 30.0
BACKOFF_CAP_S = 3600.0
STALE_LOCK_MINUTES = 30.0


async def enqueue(
    session: AsyncSession, kind: str, payload: dict | None = None, dedupe: bool = True
) -> Job | None:
    """Add a job. With ``dedupe`` (default) an already-pending job of the same
    kind is not duplicated — the scheduler ticks become idempotent."""
    if dedupe:
        existing = await session.execute(
            select(Job)
            .where(Job.kind == kind, Job.status == JobStatus.pending)
            .limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            return None
    job = Job(kind=kind, payload=payload or {}, status=JobStatus.pending)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def claim_next(
    session: AsyncSession, kinds: list[str] | None = None, worker_id: str = "backend"
) -> Job | None:
    """Atomically claim the oldest claimable job (FOR UPDATE SKIP LOCKED on
    PostgreSQL; SQLite ignores the locking clause in tests)."""
    stmt = (
        select(Job)
        .where(
            Job.status == JobStatus.pending,
            (Job.next_retry_at.is_(None))
            | (Job.next_retry_at <= datetime.now(timezone.utc)),
        )
        .order_by(Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if kinds:
        stmt = stmt.where(Job.kind.in_(kinds))
    job = (await session.execute(stmt)).scalar_one_or_none()
    if job is None:
        return None
    job.status = JobStatus.running
    job.locked_by = worker_id
    job.locked_at = datetime.now(timezone.utc)
    job.attempts += 1
    await session.commit()
    return job


def backoff_delay_s(attempts: int) -> float:
    return min(BACKOFF_BASE_S * (2 ** max(attempts - 1, 0)), BACKOFF_CAP_S)


async def complete_job(session: AsyncSession, job_id: int) -> None:
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status=JobStatus.done,
            error=None,
            next_retry_at=None,
            locked_by=None,
            locked_at=None,
        )
    )
    await session.commit()


async def fail_job(
    session: AsyncSession, job_id: int, attempts: int, error: str
) -> JobStatus:
    """Retry with exponential backoff; dead-letter after MAX_ATTEMPTS."""
    if attempts >= MAX_ATTEMPTS:
        status, next_retry = JobStatus.dead, None
    else:
        status = JobStatus.pending
        next_retry = datetime.now(timezone.utc) + timedelta(
            seconds=backoff_delay_s(attempts)
        )
    await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status=status, error=error[:2000], next_retry_at=next_retry, locked_by=None
        )
    )
    await session.commit()
    return status


async def watchdog(
    session: AsyncSession, stale_minutes: float = STALE_LOCK_MINUTES
) -> int:
    """Requeue jobs stuck in ``running`` past the stale window. Also serves as
    startup reconciliation after a backend/worker crash."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    rows = await session.execute(
        select(Job.id).where(Job.status == JobStatus.running, Job.locked_at < cutoff)
    )
    ids = [r[0] for r in rows]
    if ids:
        await session.execute(
            update(Job)
            .where(Job.id.in_(ids))
            .values(
                status=JobStatus.pending,
                locked_by=None,
                locked_at=None,
                next_retry_at=datetime.now(timezone.utc),
            )
        )
        await session.commit()
        for jid in ids:
            logger.info("job %s requeued: stale lock", jid)
    return len(ids)

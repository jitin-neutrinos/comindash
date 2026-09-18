"""Shared plumbing for the three analysis stages.

Two things live here because getting either wrong is expensive:

1. ``pending_posts`` — an anti-join on the per-stage marker column. The old
   "posts with no result row" query re-selected every post that legitimately
   produced zero rows, so half the corpus was re-analysed on every run (and,
   with real tokens, re-billed on every run). It also materialised every
   processed id into Python to build a giant ``NOT IN``.
2. ``analyse_texts`` — bounded-concurrency fan-out with per-item error
   isolation, so one bad post cannot fail a whole run and a stage failure is
   still visible in the returned stats.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import PipelineRun, Post, RunKind, RunStatus
from app.services.aihub.client import AIHubClient

logger = logging.getLogger("aihub.stage")

STUB_VERSION = "stub-1"

MARKER = {
    "ner": Post.ner_model_version,
    "priority": Post.priority_model_version,
    "sentiment": Post.sentiment_model_version,
}
MARKER_NAME = {
    "ner": "ner_model_version",
    "priority": "priority_model_version",
    "sentiment": "sentiment_model_version",
}


async def pending_posts(
    session: AsyncSession, stage: str, limit: int | None = None
) -> list[tuple[int, str]]:
    """(post_id, body_text) for posts this stage has not analysed yet."""
    column = MARKER[stage]
    stmt = (
        select(Post.id, Post.body_text).where(column.is_(None)).order_by(Post.id)
    )
    limit = limit if limit is not None else get_settings().analysis_batch_size
    if limit:
        stmt = stmt.limit(limit)
    rows = await session.execute(stmt)
    return [(r[0], r[1] or "") for r in rows]


async def mark_analysed(
    session: AsyncSession, stage: str, post_ids: Sequence[int], model_version: str
) -> None:
    if not post_ids:
        return
    await session.execute(
        update(Post)
        .where(Post.id.in_(list(post_ids)))
        .values(**{MARKER_NAME[stage]: model_version})
    )


async def clear_markers(session: AsyncSession, post_ids: Sequence[int]) -> None:
    """Re-open a post for analysis (its body text changed)."""
    if not post_ids:
        return
    await session.execute(
        update(Post)
        .where(Post.id.in_(list(post_ids)))
        .values(
            ner_model_version=None,
            priority_model_version=None,
            sentiment_model_version=None,
        )
    )


async def analyse_texts(
    client: AIHubClient,
    texts: list[str],
    stub: Callable[[str], Any],
) -> tuple[list[Any], list[str], int]:
    """Analyse every text, real or stubbed.

    Returns ``(results, errors, failed)`` where ``results[i]`` is either the
    parsed value or ``None`` when that item failed. Errors are collected, not
    raised: one unparseable post must not lose a whole run's work — but the
    caller reports the count so a systematically broken stage is visible.
    """
    if not client.is_configured:
        return [stub(t) for t in texts], [], 0

    raw = await client.predict_many(texts)
    results: list[Any] = []
    errors: list[str] = []
    for item in raw:
        if isinstance(item, BaseException):
            errors.append(f"{type(item).__name__}: {item}")
            results.append(None)
        else:
            results.append(item)
    if errors:
        logger.warning(
            "aihub stage %s: %d/%d items failed (first: %s)",
            client.kind,
            len(errors),
            len(texts),
            errors[0][:200],
        )
    return results, errors[:10], len(errors)


async def open_run(session: AsyncSession, triggered_by: str) -> int:
    run = PipelineRun(
        kind=RunKind.analyze,
        status=RunStatus.running,
        started_at=datetime.now(timezone.utc),
        triggered_by=triggered_by,
    )
    session.add(run)
    await session.flush()
    return run.id


async def close_run(
    session: AsyncSession, run_id: int, stats: dict, triggered_by: str
) -> None:
    run = await session.get(PipelineRun, run_id)
    if run is None:
        return
    run.status = RunStatus.failed if stats.get("error") else RunStatus.done
    run.finished_at = datetime.now(timezone.utc)
    run.stats = stats
    run.triggered_by = triggered_by

"""GET /api/overview — dashboard KPIs."""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    AssistantInsight,
    InsightStatus,
    InsightType,
    Post,
    Priority,
    PriorityResult,
    Sentiment,
    SentimentResult,
    Topic,
)
from app.routes.health import last_run_per_kind
from app.schemas import DeltaOut, OverviewOut

router = APIRouter(prefix="/api", tags=["overview"])

_SENTIMENT_SIGN = {Sentiment.pos: 1.0, Sentiment.neu: 0.0, Sentiment.neg: -1.0}

WINDOW_DAYS = 14


def _delta(value: float, previous: float, window_days: int = WINDOW_DAYS) -> DeltaOut:
    """Build a DeltaOut, leaving pct None when there is no baseline.

    A zero baseline has no meaningful percentage — the UI shows the raw counts
    instead of inventing a denominator.
    """
    if previous:
        pct = round((value - previous) / abs(previous), 4)
    else:
        pct = None
    if value > previous:
        direction = "up"
    elif value < previous:
        direction = "down"
    else:
        direction = "flat"
    return DeltaOut(
        value=round(value, 4),
        previous=round(previous, 4),
        pct=pct,
        direction=direction,
        window_days=window_days,
    )


async def _window_deltas(
    session: AsyncSession,
) -> tuple[dict[str, DeltaOut], datetime | None]:
    """Recent-window vs previous-window movement for the headline KPIs.

    Windows are anchored on the newest post, not on wall-clock now: ingestion
    can lag, and anchoring on now would report a quiet corpus as collapsing
    every time the ingest job is late.
    """
    newest = await session.scalar(select(func.max(Post.created_at)))
    if newest is None:
        return {}, None

    recent_start = newest - timedelta(days=WINDOW_DAYS)
    baseline_start = newest - timedelta(days=WINDOW_DAYS * 2)

    async def posts_between(start, end) -> int:
        return (
            await session.scalar(
                select(func.count(Post.id)).where(
                    Post.created_at > start, Post.created_at <= end
                )
            )
        ) or 0

    recent_posts = await posts_between(recent_start, newest)
    prior_posts = await posts_between(baseline_start, recent_start)

    async def high_priority_between(start, end) -> int:
        ranked = select(
            PriorityResult.post_id.label("post_id"),
            PriorityResult.priority.label("priority"),
            func.row_number()
            .over(
                partition_by=PriorityResult.post_id,
                order_by=PriorityResult.created_at.desc(),
            )
            .label("rn"),
        ).subquery()
        return (
            await session.scalar(
                select(func.count())
                .select_from(ranked)
                .join(Post, Post.id == ranked.c.post_id)
                .where(
                    ranked.c.rn == 1,
                    ranked.c.priority == Priority.high,
                    Post.created_at > start,
                    Post.created_at <= end,
                )
            )
        ) or 0

    async def negative_between(start, end) -> int:
        ranked = select(
            SentimentResult.post_id.label("post_id"),
            SentimentResult.sentiment.label("sentiment"),
            func.row_number()
            .over(
                partition_by=SentimentResult.post_id,
                order_by=SentimentResult.created_at.desc(),
            )
            .label("rn"),
        ).subquery()
        return (
            await session.scalar(
                select(func.count())
                .select_from(ranked)
                .join(Post, Post.id == ranked.c.post_id)
                .where(
                    ranked.c.rn == 1,
                    ranked.c.sentiment == Sentiment.neg,
                    Post.created_at > start,
                    Post.created_at <= end,
                )
            )
        ) or 0

    deltas = {
        "posts": _delta(recent_posts, prior_posts),
        "high_priority": _delta(
            await high_priority_between(recent_start, newest),
            await high_priority_between(baseline_start, recent_start),
        ),
        "negative": _delta(
            await negative_between(recent_start, newest),
            await negative_between(baseline_start, recent_start),
        ),
    }
    return deltas, newest


@router.get("/overview", response_model=OverviewOut)
async def overview(session: AsyncSession = Depends(get_session)) -> OverviewOut:
    total_posts = await session.scalar(select(func.count(Post.id))) or 0
    total_topics = await session.scalar(select(func.count(Topic.id))) or 0

    # latest priority per post → high-priority count (row_number window:
    # portable across PostgreSQL + SQLite, unlike DISTINCT ON)
    prio_ranked = select(
        PriorityResult.post_id.label("post_id"),
        PriorityResult.priority.label("priority"),
        func.row_number()
        .over(
            partition_by=PriorityResult.post_id,
            order_by=PriorityResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    high_priority = (
        await session.scalar(
            select(func.count())
            .select_from(prio_ranked)
            .where(prio_ranked.c.rn == 1, prio_ranked.c.priority == Priority.high)
        )
        or 0
    )

    # avg signed sentiment intensity over the latest result per post
    sent_ranked = select(
        SentimentResult.sentiment.label("sentiment"),
        SentimentResult.intensity.label("intensity"),
        func.row_number()
        .over(
            partition_by=SentimentResult.post_id,
            order_by=SentimentResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    signed_sum = 0.0
    n_sent = 0
    rows = await session.execute(
        select(sent_ranked.c.sentiment, sent_ranked.c.intensity).where(
            sent_ranked.c.rn == 1
        )
    )
    for sentiment, intensity in rows.all():
        signed_sum += _SENTIMENT_SIGN.get(sentiment, 0.0) * (intensity or 0.0)
        n_sent += 1
    avg_sentiment = round(signed_sum / n_sent, 4) if n_sent else 0.0

    active_pain_points = (
        await session.scalar(
            select(func.count(AssistantInsight.id)).where(
                AssistantInsight.insight_type == InsightType.pain_point,
                AssistantInsight.status == InsightStatus.active,
            )
        )
        or 0
    )

    confs = [
        (await session.scalar(select(func.avg(PriorityResult.confidence))) or 0.0),
        (await session.scalar(select(func.avg(SentimentResult.confidence))) or 0.0),
    ]
    model_confidence = round(sum(confs) / len(confs), 4)

    deltas, last_post_at = await _window_deltas(session)

    return OverviewOut(
        total_posts=total_posts,
        total_topics=total_topics,
        avg_sentiment=avg_sentiment,
        high_priority_count=high_priority,
        active_pain_points=active_pain_points,
        model_confidence=model_confidence,
        pipeline_health=await last_run_per_kind(session),
        deltas=deltas,
        last_post_at=last_post_at,
    )

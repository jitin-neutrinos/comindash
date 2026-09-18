"""GET /api/overview — dashboard KPIs."""

from __future__ import annotations

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
from app.schemas import OverviewOut

router = APIRouter(prefix="/api", tags=["overview"])

_SENTIMENT_SIGN = {Sentiment.pos: 1.0, Sentiment.neu: 0.0, Sentiment.neg: -1.0}


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

    return OverviewOut(
        total_posts=total_posts,
        total_topics=total_topics,
        avg_sentiment=avg_sentiment,
        high_priority_count=high_priority,
        active_pain_points=active_pain_points,
        model_confidence=model_confidence,
        pipeline_health=await last_run_per_kind(session),
    )

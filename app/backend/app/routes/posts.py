"""GET /api/posts — paginated, filterable, per-post analysis badges."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Post, Priority, PriorityResult, Sentiment, SentimentResult, Topic
from app.schemas import AnalysisBadge, PaginatedOut, PostOut

router = APIRouter(prefix="/api/posts", tags=["posts"])


@router.get("", response_model=PaginatedOut)
async def list_posts(
    topic_id: int | None = Query(None),
    q: str | None = Query(None, description="body substring"),
    priority: Literal["high", "medium", "low"] | None = Query(None),
    sentiment: Literal["pos", "neu", "neg"] | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedOut:
    prio_sub = select(
        PriorityResult.post_id.label("post_id"),
        PriorityResult.priority.label("priority"),
        PriorityResult.confidence.label("p_conf"),
        PriorityResult.model_version.label("model_version"),
        func.row_number()
        .over(
            partition_by=PriorityResult.post_id,
            order_by=PriorityResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    sent_sub = select(
        SentimentResult.post_id.label("post_id"),
        SentimentResult.sentiment.label("sentiment"),
        SentimentResult.intensity.label("intensity"),
        SentimentResult.confidence.label("s_conf"),
        func.row_number()
        .over(
            partition_by=SentimentResult.post_id,
            order_by=SentimentResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()

    stmt = (
        select(
            Post,
            prio_sub.c.priority,
            prio_sub.c.p_conf,
            prio_sub.c.model_version,
            sent_sub.c.sentiment,
            sent_sub.c.intensity,
            sent_sub.c.s_conf,
        )
        .outerjoin(prio_sub, (prio_sub.c.post_id == Post.id) & (prio_sub.c.rn == 1))
        .outerjoin(sent_sub, (sent_sub.c.post_id == Post.id) & (sent_sub.c.rn == 1))
    )
    if topic_id:
        stmt = stmt.where(Post.topic_id == topic_id)
    if q:
        stmt = stmt.where(Post.body_text.ilike(f"%{q}%"))
    if priority:
        stmt = stmt.where(prio_sub.c.priority == Priority(priority))
    if sentiment:
        stmt = stmt.where(sent_sub.c.sentiment == Sentiment(sentiment))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await session.scalar(count_stmt) or 0
    rows = (
        await session.execute(
            stmt.order_by(Post.created_at.desc().nullslast(), Post.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items = []
    for post, pr, p_conf, model_version, sent, intensity, s_conf in rows:
        out = PostOut.model_validate(post)
        out.analysis = AnalysisBadge(
            priority=pr.value if pr else None,
            priority_confidence=p_conf,
            sentiment=sent.value if sent else None,
            sentiment_intensity=intensity,
            sentiment_confidence=s_conf,
            model_version=model_version,
        )
        items.append(out)
    return PaginatedOut(items=items, total=total, limit=limit, offset=offset)

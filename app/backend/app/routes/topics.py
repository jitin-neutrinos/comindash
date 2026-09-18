"""GET /api/topics — paginated, filterable."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Topic
from app.schemas import PaginatedOut, TopicOut

router = APIRouter(prefix="/api/topics", tags=["topics"])


@router.get("", response_model=PaginatedOut)
async def list_topics(
    q: str | None = Query(None, description="title substring"),
    category: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedOut:
    stmt = select(Topic)
    if q:
        stmt = stmt.where(or_(Topic.title.ilike(f"%{q}%"), Topic.slug.ilike(f"%{q}%")))
    if category:
        stmt = stmt.where(Topic.category == category)

    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        (
            await session.execute(
                stmt.order_by(Topic.last_posted_at.desc().nullslast(), Topic.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    items = [TopicOut.model_validate(r) for r in rows]
    return PaginatedOut(items=items, total=total, limit=limit, offset=offset)

"""GET /api/pain-points — ranked pain_point insight cards."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AssistantInsight, InsightEvidence, InsightStatus, InsightType
from app.routes.insights import _to_insight_out
from app.schemas import InsightOut

router = APIRouter(prefix="/api", tags=["pain-points"])

_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "": 3}


@router.get("/pain-points", response_model=list[InsightOut])
async def pain_points(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[InsightOut]:
    rows = (
        (
            await session.execute(
                select(AssistantInsight)
                .where(
                    AssistantInsight.insight_type == InsightType.pain_point,
                    AssistantInsight.status == InsightStatus.active,
                )
                .order_by(AssistantInsight.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )

    evidence_counts = dict(
        (
            await session.execute(
                select(InsightEvidence.insight_id, func.count())
                .where(InsightEvidence.insight_id.in_([r.id for r in rows] or [0]))
                .group_by(InsightEvidence.insight_id)
            )
        ).all()
    )

    out = [await _to_insight_out(session, r) for r in rows]
    for card in out:
        card.evidence_count = evidence_counts.get(card.id, 0)
    out.sort(key=lambda c: (_SEVERITY_RANK.get(c.severity, 3), -c.evidence_count, c.id))
    return out

"""GET /api/relationships — insight_relationships graph data."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AssistantInsight, InsightRelationship
from app.schemas import GraphEdge, GraphNode, RelationshipGraphOut

router = APIRouter(prefix="/api", tags=["relationships"])


@router.get("/relationships", response_model=RelationshipGraphOut)
async def relationships(
    insight_id: int | None = Query(None, description="restrict to one insight"),
    limit: int = Query(200, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
) -> RelationshipGraphOut:
    stmt = select(InsightRelationship)
    if insight_id:
        stmt = stmt.where(InsightRelationship.insight_id == insight_id)
    rows = (
        (
            await session.execute(
                stmt.order_by(InsightRelationship.strength.desc()).limit(limit)
            )
        )
        .scalars()
        .all()
    )

    insight_ids = {r.insight_id for r in rows}
    titles = {}
    if insight_ids:
        title_rows = await session.execute(
            select(AssistantInsight.id, AssistantInsight.title).where(
                AssistantInsight.id.in_(insight_ids)
            )
        )
        titles = dict(title_rows.all())

    nodes: dict[str, GraphNode] = {}
    edges: list[GraphEdge] = []
    for r in rows:
        subject_key = f"{r.subject_type}:{r.subject_value}"
        object_key = f"{r.object_type}:{r.object_value}"
        nodes.setdefault(
            subject_key,
            GraphNode(id=subject_key, label=r.subject_value, type=r.subject_type),
        )
        nodes.setdefault(
            object_key,
            GraphNode(id=object_key, label=r.object_value, type=r.object_type),
        )
        edges.append(
            GraphEdge(
                source=subject_key,
                target=object_key,
                relation=r.relation,
                strength=r.strength,
                insight_id=r.insight_id,
            )
        )
    return RelationshipGraphOut(nodes=list(nodes.values()), edges=edges)

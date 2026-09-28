"""GET /api/relationships — community knowledge graph.
POST /api/relationships/brief — AI briefing for one node or edge.

The graph has two layers (see services/relationship_graph): the observed
co-mention layer derived live from `extractions`, and the reasoned layer from
the nightly analyst's asserted relationships. The legacy insight-only shape is
still served under ``?view=asserted`` so nothing that consumed it breaks.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import AssistantInsight, InsightRelationship
from app.schemas import GraphEdge, GraphNode, RelationshipGraphOut
from app.services import relationship_brief
from app.services.relationship_graph import load_graph

router = APIRouter(prefix="/api", tags=["relationships"])


@router.get("/relationships")
async def relationships(
    view: str = Query("graph", pattern="^(graph|asserted)$"),
    insight_id: int | None = Query(None, description="restrict to one insight"),
    limit: int = Query(200, ge=1, le=1000),
    max_people: int = Query(28, ge=4, le=80),
    min_edge: int = Query(2, ge=1, le=20),
    session: AsyncSession = Depends(get_session),
):
    if view == "graph":
        return await load_graph(session, max_people=max_people, min_edge=min_edge)

    # --- legacy asserted-only shape ------------------------------------------
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
    if insight_ids:
        await session.execute(
            select(AssistantInsight.id, AssistantInsight.title).where(
                AssistantInsight.id.in_(insight_ids)
            )
        )

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


class BriefRequest(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=2)
    labels: dict[str, str] = {}
    stats: dict = {}
    refresh: bool = False


@router.post("/relationships/brief")
async def relationship_brief_endpoint(
    body: BriefRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    return await relationship_brief.get_brief(
        session,
        keys=body.keys,
        labels=body.labels,
        stats=body.stats,
        refresh=body.refresh,
    )

"""GET /api/insights, GET /api/insights/{id},
POST /api/insights/ingest (assistant write-back gate, token-authed)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import (
    AssistantInsight,
    InsightEvidence,
    InsightRelationship,
    InsightStatus,
    InsightType,
    Post,
    Topic,
)
from app.schemas import (
    EvidenceOut,
    InsightDetailOut,
    InsightOut,
    IngestErrorItem,
    IngestResultOut,
    RelationshipOut,
)
from app.services import insights_gate

logger = logging.getLogger("routes.insights")

router = APIRouter(prefix="/api/insights", tags=["insights"])


async def _to_insight_out(session: AsyncSession, row: AssistantInsight) -> InsightOut:
    count = await session.scalar(
        select(func.count(InsightEvidence.id)).where(
            InsightEvidence.insight_id == row.id
        )
    )
    data = InsightOut.model_validate(
        {
            "id": row.id,
            "insight_type": row.insight_type.value,
            "title": row.title,
            "body": row.body,
            "severity": row.severity,
            "priority_rollup": row.priority_rollup,
            "status": row.status.value,
            "assistant_version": row.assistant_version,
            "valid_from": row.valid_from,
            "created_at": row.created_at,
            "evidence_count": count or 0,
        }
    )
    return data


@router.get("", response_model=list[InsightOut])
async def list_insights(
    insight_type: str | None = Query(
        None, description="pain_point|trend|anomaly|relationship|recommendation"
    ),
    status: str | None = Query(None, description="active|resolved|superseded"),
    severity: str | None = Query(None, description="high|medium|low"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[InsightOut]:
    stmt = select(AssistantInsight)
    if insight_type:
        try:
            stmt = stmt.where(
                AssistantInsight.insight_type == InsightType(insight_type)
            )
        except ValueError:
            raise HTTPException(
                status_code=422, detail=f"unknown insight_type: {insight_type}"
            )
    if status:
        try:
            stmt = stmt.where(AssistantInsight.status == InsightStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"unknown status: {status}")
    if severity:
        stmt = stmt.where(AssistantInsight.severity == severity)
    stmt = stmt.order_by(AssistantInsight.created_at.desc()).limit(limit).offset(offset)
    rows = (await session.execute(stmt)).scalars().all()
    return [await _to_insight_out(session, r) for r in rows]


@router.get("/{insight_id}", response_model=InsightDetailOut)
async def insight_detail(
    insight_id: int, session: AsyncSession = Depends(get_session)
) -> InsightDetailOut:
    row = await session.get(AssistantInsight, insight_id)
    if row is None:
        raise HTTPException(status_code=404, detail="insight not found")
    base = await _to_insight_out(session, row)

    evidence_rows = await session.execute(
        select(
            InsightEvidence,
            Post.discourse_post_id,
            Post.topic_id,
            Topic.title,
            Topic.slug,
            Topic.discourse_topic_id,
        )
        .join(Post, Post.id == InsightEvidence.post_id)
        .join(Topic, Topic.id == Post.topic_id, isouter=True)
        .where(InsightEvidence.insight_id == insight_id)
    )
    base_url = get_settings().discourse_base_url.rstrip("/")
    evidence = []
    for ev, dp_id, t_id, t_title, t_slug, t_did in evidence_rows.all():
        url = None
        if t_did is not None and dp_id is not None:
            url = f"{base_url}/t/{t_slug or 'topic'}/{t_did}/{dp_id}"
        evidence.append(
            EvidenceOut(
                post_id=ev.post_id,
                discourse_post_id=dp_id,
                topic_id=t_id,
                topic_title=t_title,
                quote=ev.quote,
                relevance_note=ev.relevance_note,
                url=url,
            )
        )

    rel_rows = await session.execute(
        select(InsightRelationship).where(InsightRelationship.insight_id == insight_id)
    )
    relationships = [
        RelationshipOut(
            subject_type=r.subject_type,
            subject_value=r.subject_value,
            relation=r.relation,
            object_type=r.object_type,
            object_value=r.object_value,
            strength=r.strength,
        )
        for r in rel_rows.scalars()
    ]

    return InsightDetailOut(
        **base.model_dump(), evidence=evidence, relationships=relationships
    )


@router.post("/ingest", response_model=IngestResultOut)
async def ingest_insights_route(
    payload: dict,
    x_ingest_token: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
) -> IngestResultOut:
    """Assistant write-back endpoint.

    Header ``X-Ingest-Token`` must match ``INGEST_TOKEN``. Payload is schema-
    + evidence-validated; invalid items are rejected with per-item 422 errors
    (the assistant retries next cycle) and audited.
    """
    expected = get_settings().ingest_token
    if not x_ingest_token:
        raise HTTPException(status_code=401, detail="X-Ingest-Token header required")
    if x_ingest_token != expected:
        raise HTTPException(status_code=403, detail="invalid X-Ingest-Token")

    parsed = insights_gate.parse_payload(payload)
    if parsed is None:
        detail = insights_gate.envelope_errors(payload)
        raise HTTPException(
            status_code=422,
            detail={"message": "payload failed schema validation", "errors": detail},
        )

    result = await insights_gate.ingest_insights(session, parsed)
    if result.accepted == 0:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "no insight passed validation",
                "errors": [e.model_dump() for e in result.errors],
            },
        )
    return IngestResultOut(
        accepted=result.accepted,
        rejected=result.rejected,
        insight_ids=result.insight_ids,
        errors=[IngestErrorItem(index=e.index, errors=e.errors) for e in result.errors],
    )

"""Schema validation + evidence check for the assistant → /api/insights/ingest
path. Also used internally by the assistant cycle so both entry points apply
the exact same gate.

Contract (specs/SPEC.md):
- every evidence discourse_post_id must exist in posts
- min 1 evidence per insight
- severity / insight_type enums enforced
- invalid items are rejected with per-item errors (assistant retries next
  cycle); valid items are versioned-inserted (previous active insight with the
  same type+title becomes ``superseded``)
- rejections leave an audit trail
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AppConfig,
    AssistantInsight,
    InsightEvidence,
    InsightRelationship,
    InsightStatus,
    InsightType,
    PipelineRun,
    Post,
    RunKind,
    RunStatus,
    Topic,
)

logger = logging.getLogger("insights_gate")

SEVERITIES = {"high", "medium", "low"}


class EvidenceIn(BaseModel):
    discourse_post_id: int
    quote: str = ""
    relevance_note: str = ""


class RelationshipIn(BaseModel):
    subject_type: str = "entity"
    subject_value: str
    relation: str
    object_type: str = "topic"
    object_value: str
    strength: float = Field(default=0.5, ge=0.0, le=1.0)


class InsightIn(BaseModel):
    insight_type: InsightType
    title: str = Field(min_length=1, max_length=512)
    body: str = ""
    severity: str
    evidence: list[EvidenceIn] = Field(min_length=1)
    relationships: list[RelationshipIn] = []

    @field_validator("severity")
    @classmethod
    def _severity_enum(cls, v: str) -> str:
        if v not in SEVERITIES:
            raise ValueError(f"severity must be one of {sorted(SEVERITIES)}, got {v!r}")
        return v


class IngestPayload(BaseModel):
    assistant_version: str = "v1"
    run_ref: str = ""
    insights: list[InsightIn] = Field(min_length=1)


class ItemError(BaseModel):
    index: int
    errors: list[str]


class GateResult(BaseModel):
    accepted: int
    rejected: int
    insight_ids: list[int]
    errors: list[ItemError]


def parse_payload(raw: dict) -> IngestPayload | None:
    """Strict schema validation. Returns None when the envelope itself is
    invalid (caller maps that to a blanket 422)."""
    try:
        return IngestPayload.model_validate(raw)
    except ValidationError:
        return None


def envelope_errors(raw: dict) -> list[str]:
    try:
        IngestPayload.model_validate(raw)
    except ValidationError as e:
        return [f"{err['loc']}: {err['msg']}" for err in e.errors()]
    return []


async def ingest_insights(
    session: AsyncSession, payload: IngestPayload, run_id: int | None = None
) -> GateResult:
    """Validate evidence post ids, versioned-insert valid insights, audit the rest."""
    now = datetime.now(timezone.utc)
    errors: list[ItemError] = []
    insight_ids: list[int] = []

    all_post_refs = [
        e.discourse_post_id for ins in payload.insights for e in ins.evidence
    ]
    found: dict[int, tuple[int, int]] = {}
    if all_post_refs:
        rows = await session.execute(
            select(Post.id, Post.discourse_post_id, Post.topic_id).where(
                Post.discourse_post_id.in_(all_post_refs)
            )
        )
        found = {r.discourse_post_id: (r.id, r.topic_id) for r in rows}

    # pipeline run row representing this assistant delivery
    if run_id is None:
        run = PipelineRun(
            kind=RunKind.assistant,
            status=RunStatus.done,
            started_at=now,
            finished_at=now,
            triggered_by=f"ingest:{payload.run_ref}",
        )
        session.add(run)
        await session.flush()
        run_id = run.id

    for idx, ins in enumerate(payload.insights):
        missing = sorted(
            {
                e.discourse_post_id
                for e in ins.evidence
                if e.discourse_post_id not in found
            }
        )
        if missing:
            errors.append(
                ItemError(
                    index=idx,
                    errors=[
                        f"evidence discourse_post_id not found in posts: {missing}"
                    ],
                )
            )
            continue

        # versioned insert: supersede the previous active insight of the same
        # type+title from an older delivery
        older = await session.execute(
            select(AssistantInsight).where(
                AssistantInsight.insight_type == ins.insight_type,
                AssistantInsight.title == ins.title,
                AssistantInsight.status == InsightStatus.active,
            )
        )
        for prev in older.scalars():
            prev.status = InsightStatus.superseded

        row = AssistantInsight(
            run_id=run_id,
            assistant_version=payload.assistant_version,
            insight_type=ins.insight_type,
            title=ins.title,
            body=ins.body,
            severity=ins.severity,
            status=InsightStatus.active,
            valid_from=now,
            created_at=now,
        )
        session.add(row)
        await session.flush()
        insight_ids.append(row.id)

        for ev in ins.evidence:
            session.add(
                InsightEvidence(
                    insight_id=row.id,
                    post_id=found[ev.discourse_post_id][0],
                    quote=ev.quote,
                    relevance_note=ev.relevance_note,
                )
            )
        for rel in ins.relationships:
            session.add(
                InsightRelationship(
                    insight_id=row.id,
                    subject_type=rel.subject_type,
                    subject_value=rel.subject_value,
                    relation=rel.relation,
                    object_type=rel.object_type,
                    object_value=rel.object_value,
                    strength=rel.strength,
                )
            )

    if errors:
        audit = AppConfig(
            key=f"ingest_audit:{payload.run_ref}:{int(now.timestamp())}",
            value={
                "run_ref": payload.run_ref,
                "accepted": len(insight_ids),
                "rejected": len(errors),
                "errors": [e.model_dump() for e in errors],
            },
            updated_at=now,
        )
        session.add(audit)
        logger.warning(
            "insight ingest rejected %d/%d items (run_ref=%s): %s",
            len(errors),
            len(payload.insights),
            payload.run_ref,
            errors,
        )

    await session.commit()
    return GateResult(
        accepted=len(insight_ids),
        rejected=len(errors),
        insight_ids=insight_ids,
        errors=errors,
    )


async def evidence_post_url(
    session: AsyncSession, topic_id: int | None, discourse_post_id: int | None
) -> str | None:
    """Build a forum URL for an evidence post (topic slug + post id)."""
    if topic_id is None or discourse_post_id is None:
        return None
    row = await session.execute(
        select(Topic.slug, Topic.discourse_topic_id).where(Topic.id == topic_id)
    )
    r = row.first()
    if r is None:
        return None
    from app.config import get_settings

    base = get_settings().discourse_base_url.rstrip("/")
    return f"{base}/t/{r.slug or 'topic'}/{r.discourse_topic_id}/{discourse_post_id}"

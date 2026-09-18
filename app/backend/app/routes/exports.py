"""GET /api/export.csv?dataset= — CSV export."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    AssistantInsight,
    InsightEvidence,
    Post,
    PriorityResult,
    SentimentResult,
    Topic,
)

router = APIRouter(prefix="/api", tags=["exports"])

DATASETS = {"posts", "topics", "insights", "priority", "sentiment", "evidence"}
_EXPORT_LIMIT = 50000


def _csv_stream(headers: list[str], rows: list[list]) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="export.csv"'},
    )


@router.get("/export.csv")
async def export_csv(
    dataset: str = Query(...),
    limit: int = Query(10000, ge=1, le=_EXPORT_LIMIT),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    if dataset not in DATASETS:
        raise HTTPException(
            status_code=422, detail=f"dataset must be one of {sorted(DATASETS)}"
        )

    if dataset == "topics":
        rows = (await session.execute(select(Topic).limit(limit))).scalars().all()
        return _csv_stream(
            [
                "id",
                "discourse_topic_id",
                "title",
                "category",
                "slug",
                "posts_count",
                "views",
                "like_count",
            ],
            [
                [
                    t.id,
                    t.discourse_topic_id,
                    t.title,
                    t.category,
                    t.slug,
                    t.posts_count,
                    t.views,
                    t.like_count,
                ]
                for t in rows
            ],
        )

    if dataset == "posts":
        rows = (await session.execute(select(Post).limit(limit))).scalars().all()
        return _csv_stream(
            [
                "id",
                "discourse_post_id",
                "topic_id",
                "post_number",
                "author_hash",
                "language",
                "created_at",
                "body_text",
            ],
            [
                [
                    p.id,
                    p.discourse_post_id,
                    p.topic_id,
                    p.post_number,
                    p.author_hash,
                    p.language,
                    p.created_at,
                    p.body_text,
                ]
                for p in rows
            ],
        )

    if dataset == "insights":
        rows = (
            (await session.execute(select(AssistantInsight).limit(limit)))
            .scalars()
            .all()
        )
        return _csv_stream(
            [
                "id",
                "insight_type",
                "title",
                "severity",
                "status",
                "assistant_version",
                "created_at",
            ],
            [
                [
                    i.id,
                    i.insight_type.value,
                    i.title,
                    i.severity,
                    i.status.value,
                    i.assistant_version,
                    i.created_at,
                ]
                for i in rows
            ],
        )

    if dataset == "priority":
        rows = (
            (await session.execute(select(PriorityResult).limit(limit))).scalars().all()
        )
        return _csv_stream(
            [
                "id",
                "post_id",
                "run_id",
                "model_version",
                "priority",
                "confidence",
                "reviewed",
                "created_at",
            ],
            [
                [
                    r.id,
                    r.post_id,
                    r.run_id,
                    r.model_version,
                    r.priority.value,
                    r.confidence,
                    r.reviewed,
                    r.created_at,
                ]
                for r in rows
            ],
        )

    if dataset == "sentiment":
        rows = (
            (await session.execute(select(SentimentResult).limit(limit)))
            .scalars()
            .all()
        )
        return _csv_stream(
            [
                "id",
                "post_id",
                "run_id",
                "model_version",
                "sentiment",
                "intensity",
                "confidence",
                "reviewed",
                "created_at",
            ],
            [
                [
                    r.id,
                    r.post_id,
                    r.run_id,
                    r.model_version,
                    r.sentiment.value,
                    r.intensity,
                    r.confidence,
                    r.reviewed,
                    r.created_at,
                ]
                for r in rows
            ],
        )

    rows = (await session.execute(select(InsightEvidence).limit(limit))).scalars().all()
    return _csv_stream(
        ["id", "insight_id", "post_id", "quote", "relevance_note"],
        [[e.id, e.insight_id, e.post_id, e.quote, e.relevance_note] for e in rows],
    )

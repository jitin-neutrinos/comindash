"""GET /api/trends?metric=&days= — time-series for the dashboard charts."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Extraction, Post, PriorityResult, Sentiment, SentimentResult
from app.schemas import TrendPointOut
from app.services.metrics_brief import get_brief
from app.services.metrics_intel import load_metric_intel

router = APIRouter(prefix="/api", tags=["trends"])

METRICS = {"volume", "priority", "sentiment", "entity"}


@router.get("/trends", response_model=list[TrendPointOut])
async def trends(
    metric: str = Query("volume"),
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100, description="entity metric: top-N entities"),
    session: AsyncSession = Depends(get_session),
) -> list[TrendPointOut]:
    if metric not in METRICS:
        raise HTTPException(
            status_code=422, detail=f"metric must be one of {sorted(METRICS)}"
        )
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    if metric == "volume":
        rows = await session.execute(
            select(func.date(Post.created_at), func.count())
            .where(Post.created_at >= cutoff)
            .group_by(func.date(Post.created_at))
            .order_by(func.date(Post.created_at))
        )
        return [TrendPointOut(date=str(d), value=float(n)) for d, n in rows]

    if metric == "priority":
        rows = await session.execute(
            select(func.date(Post.created_at), PriorityResult.priority, func.count())
            .join(Post, Post.id == PriorityResult.post_id)
            .where(Post.created_at >= cutoff)
            .group_by(func.date(Post.created_at), PriorityResult.priority)
            .order_by(func.date(Post.created_at))
        )
        by_date: dict[str, dict[str, float]] = {}
        for d, priority, n in rows:
            by_date.setdefault(str(d), {})[priority.value] = float(n)
        return [
            TrendPointOut(date=d, value=sum(b.values()), extra=b)
            for d, b in sorted(by_date.items())
        ]

    if metric == "sentiment":
        rows = await session.execute(
            select(
                func.date(Post.created_at),
                SentimentResult.sentiment,
                func.avg(SentimentResult.intensity),
                func.count(),
            )
            .join(Post, Post.id == SentimentResult.post_id)
            .where(Post.created_at >= cutoff)
            .group_by(func.date(Post.created_at), SentimentResult.sentiment)
        )
        by_date = {}
        for d, sentiment, avg_intensity, n in rows:
            bucket = by_date.setdefault(
                str(d), {"weighted": 0.0, "n": 0, "pos": 0.0, "neu": 0.0, "neg": 0.0}
            )
            sign = {Sentiment.pos: 1.0, Sentiment.neu: 0.0, Sentiment.neg: -1.0}[
                sentiment
            ]
            bucket["weighted"] += sign * (avg_intensity or 0.0) * n
            bucket["n"] += n
            bucket[sentiment.value] += float(n)
        return [
            TrendPointOut(
                date=d,
                value=round(b["weighted"] / b["n"], 4) if b["n"] else 0.0,
                extra={"pos": b["pos"], "neu": b["neu"], "neg": b["neg"]},
            )
            for d, b in sorted(by_date.items())
        ]

    # entity frequency
    rows = await session.execute(
        select(Extraction.entity_text, Extraction.entity_label, func.count())
        .join(Post, Post.id == Extraction.post_id)
        .where(Post.created_at >= cutoff)
        .group_by(Extraction.entity_text, Extraction.entity_label)
        .order_by(func.count().desc())
        .limit(limit)
    )
    return [
        TrendPointOut(
            date=f"{label.upper()}:{text[:40]}", value=float(n), extra={"count": float(n)}
        )
        for text, label, n in rows
    ]


# --- live metric intelligence -------------------------------------------------
#
# /trends answers "what are the numbers?"; these answer "is this normal, and
# what changed?" — anomalies, change points, movers and mix drift measured from
# the same rows the chart renders, plus an on-demand grounded brief.


class MetricBriefRequest(BaseModel):
    refresh: bool = False
    days: int = 30


@router.get("/metrics/intel")
async def metrics_intel(
    metric: str = Query("volume"),
    days: int = Query(30, ge=7, le=365),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if metric not in METRICS:
        raise HTTPException(
            status_code=422, detail=f"metric must be one of {sorted(METRICS)}"
        )
    return await load_metric_intel(session, metric, days=days)


@router.post("/metrics/{metric}/brief")
async def metrics_brief(
    metric: str,
    body: MetricBriefRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    if metric not in METRICS:
        raise HTTPException(
            status_code=422, detail=f"metric must be one of {sorted(METRICS)}"
        )
    req = body or MetricBriefRequest()
    days = max(7, min(req.days, 365))
    intel = await load_metric_intel(session, metric, days=days)
    return await get_brief(session, intel, refresh=req.refresh)

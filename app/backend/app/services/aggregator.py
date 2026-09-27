"""Rollups: topic-level priority vote (confidence-weighted + recency decay)
and daily/weekly aggregates. ``run_aggregation`` is also the analyze-stage
orchestrator the worker calls (extraction → priority → sentiment → rollups)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Post,
    Priority,
    PriorityResult,
    RunKind,
    RunStatus,
    Sentiment,
    SentimentResult,
    Topic,
    PipelineRun,
)
from app.services.analysis.extraction import run_extraction
from app.services.analysis.priority import run_priority
from app.services.analysis.sentiment import run_sentiment
from app.services.database_session import get_run_session
from app.services.discourse import as_utc

logger = logging.getLogger("aggregator")

HALF_LIFE_DAYS = 14.0
_PRIORITY_VALUE = {Priority.high: 1.0, Priority.medium: 0.5, Priority.low: 0.0}
_SENTIMENT_SIGN = {Sentiment.pos: 1.0, Sentiment.neu: 0.0, Sentiment.neg: -1.0}


def _age_days(dt: datetime | None, now: datetime) -> float:
    dt = as_utc(dt) or now
    return max(0.0, (now - dt).total_seconds() / 86400.0)


def vote_priority(
    results: list[tuple[Priority, float, datetime | None]], now: datetime | None = None
) -> tuple[str, float]:
    """Confidence-weighted priority vote with exponential recency decay.

    weight = confidence * 0.5 ** (age_days / HALF_LIFE_DAYS)
    score  = Σ(weight * value) / Σ(weight)   (high=1.0, medium=0.5, low=0.0)
    Returns (rollup_label, score).
    """
    now = now or datetime.now(timezone.utc)
    total_w = 0.0
    weighted = 0.0
    for priority, confidence, created_at in results:
        decay = 0.5 ** (_age_days(created_at, now) / HALF_LIFE_DAYS)
        w = max(0.0, confidence) * decay
        total_w += w
        weighted += w * _PRIORITY_VALUE.get(priority, 0.0)
    if total_w == 0:
        return "low", 0.0
    score = weighted / total_w
    label = "high" if score >= 0.66 else ("medium" if score >= 0.33 else "low")
    return label, round(score, 4)


async def topic_priority_rollups(session: AsyncSession) -> list[dict]:
    """Per-topic priority rollup from the latest result of each post."""
    now = datetime.now(timezone.utc)
    rows = await session.execute(
        select(
            Topic.id,
            Topic.title,
            Post.id,
            PriorityResult.priority,
            PriorityResult.confidence,
            PriorityResult.created_at,
        )
        .join(Post, Post.topic_id == Topic.id)
        .join(PriorityResult, PriorityResult.post_id == Post.id)
        .order_by(PriorityResult.created_at)
    )
    by_topic: dict[int, dict] = {}
    per_post: dict[tuple[int, int], tuple] = {}
    for topic_id, title, post_id, priority, confidence, created_at in rows:
        entry = by_topic.setdefault(
            topic_id, {"topic_id": topic_id, "title": title, "results": []}
        )
        # rows are created_at-ordered: the last write per post wins
        if (topic_id, post_id) in per_post:
            entry["results"].remove(per_post[(topic_id, post_id)])
        res = (priority, confidence, created_at)
        per_post[(topic_id, post_id)] = res
        entry["results"].append(res)
    out: list[dict] = []
    for entry in by_topic.values():
        label, score = vote_priority(entry["results"], now)
        out.append(
            {
                "topic_id": entry["topic_id"],
                "title": entry["title"],
                "priority_rollup": label,
                "score": score,
            }
        )
    out.sort(key=lambda r: (-r["score"], r["topic_id"]))
    return out


async def daily_aggregates(
    session: AsyncSession, days: int = 30
) -> dict[str, list[dict]]:
    """Daily post volume, sentiment trend and priority mix over the window."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    volume_rows = await session.execute(
        select(func.date(Post.created_at), func.count())
        .where(Post.created_at >= cutoff)
        .group_by(func.date(Post.created_at))
        .order_by(func.date(Post.created_at))
    )
    volume = [{"date": str(d), "posts": n} for d, n in volume_rows]

    sent_rows = await session.execute(
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
    sentiment_by_day: dict[str, dict[str, float]] = {}
    for d, sentiment, avg_intensity, n in sent_rows:
        bucket = sentiment_by_day.setdefault(
            str(d), {"pos": 0.0, "neu": 0.0, "neg": 0.0, "_n": 0}
        )
        bucket[sentiment.value] = (avg_intensity or 0.0) * n
        bucket["_n"] += n
    sentiment = [
        {
            "date": d,
            "avg": round((b["pos"] - b["neg"]) / b["_n"], 4) if b["_n"] else 0.0,
        }
        for d, b in sorted(sentiment_by_day.items())
    ]

    prio_rows = await session.execute(
        select(func.date(Post.created_at), PriorityResult.priority, func.count())
        .join(Post, Post.id == PriorityResult.post_id)
        .where(Post.created_at >= cutoff)
        .group_by(func.date(Post.created_at), PriorityResult.priority)
    )
    prio_by_day: dict[str, dict[str, int]] = {}
    for d, priority, n in prio_rows:
        prio_by_day.setdefault(str(d), {"high": 0, "medium": 0, "low": 0})[
            priority.value
        ] = n
    priority = [{"date": d, **counts} for d, counts in sorted(prio_by_day.items())]

    return {"volume": volume, "sentiment": sentiment, "priority": priority}


async def run_aggregation(
    session: AsyncSession | None = None, forum_id: int | None = None
) -> dict:
    """Analyze-stage orchestrator (worker entry point): run every analysis
    stage (stub-safe) then compute rollups."""
    if session is None:
        async with get_run_session() as s:
            return await run_aggregation(s, forum_id=forum_id)

    now = datetime.now(timezone.utc)
    run = PipelineRun(
        kind=RunKind.analyze,
        status=RunStatus.running,
        started_at=now,
        triggered_by="aggregation",
    )
    session.add(run)
    await session.flush()

    stats: dict = {"stage": "aggregation"}
    try:
        extraction_stats = await run_extraction(session, run_id=run.id)
        priority_stats = await run_priority(session, run_id=run.id)
        sentiment_stats = await run_sentiment(session, run_id=run.id)
        rollups = await topic_priority_rollups(session)
        daily = await daily_aggregates(session, days=7)

        stats = {
            "stage": "aggregation",
            "extraction": extraction_stats,
            "priority": priority_stats,
            "sentiment": sentiment_stats,
            "topics_rolled_up": len(rollups),
            "top_topics": rollups[:5],
            "daily": {k: len(v) for k, v in daily.items()},
        }
        # A stage that failed every call is a broken contract, not bad luck.
        # Surface it as a run failure so the job queue retries with backoff
        # instead of recording a green run that stored nothing.
        stage_errors = [
            st["error"]
            for st in (extraction_stats, priority_stats, sentiment_stats)
            if isinstance(st, dict) and st.get("error")
        ]
        if stage_errors:
            raise RuntimeError("; ".join(stage_errors)[:1000])
        run.status = RunStatus.done
    except Exception as e:  # noqa: BLE001 — recorded on the run, then re-raised
        stats = {**stats, "error": str(e)[:500]}
        run.status = RunStatus.failed
        run.error = str(e)[:2000]
        run.finished_at = datetime.now(timezone.utc)
        run.stats = stats
        await session.commit()
        logger.exception("aggregation failed")
        raise
    run.finished_at = datetime.now(timezone.utc)
    run.stats = stats
    await session.commit()
    return stats

"""Sentiment classifier -> sentiment_results.

Served by the inference sidecar (Laya classifier, ``model_version="laya-v1"``);
the lexicon below is the deterministic stub fallback (``model_version="stub-1"``).
Intensity is derived from the winning class's word-count margin so it lives on
the same 0..1 scale a real model's confidence would produce.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Post, Sentiment, SentimentResult
from app.services.analysis import _stage
from app.services.analysis._stage import STUB_VERSION

POSITIVE_WORDS = {
    "love", "great", "awesome", "excellent", "works", "happy", "fast", "good",
    "nice", "solved", "perfect", "thanks", "helpful", "smooth", "solid",
    "amazing", "wonderful", "improved", "fixed",
}
NEGATIVE_WORDS = {
    "bug", "broken", "crash", "crashes", "error", "fail", "fails", "failing",
    "slow", "issue", "problem", "problems", "hate", "terrible", "awful",
    "confusing", "frustrated", "frustrating", "regression", "blocked",
    "annoying", "worse", "unusable",
}


def stub_sentiment(text: str) -> tuple[Sentiment, float, float, str | None]:
    """Deterministic lexicon: (sentiment, intensity, confidence, result_id)."""
    words = re.findall(r"[a-z']+", (text or "").lower())
    pos = sum(1 for w in words if w in POSITIVE_WORDS)
    neg = sum(1 for w in words if w in NEGATIVE_WORDS)
    if pos > neg:
        return Sentiment.pos, min(1.0, (pos - neg) / 5), min(0.95, 0.5 + 0.1 * pos), None
    if neg > pos:
        return Sentiment.neg, min(1.0, (neg - pos) / 5), min(0.95, 0.5 + 0.1 * neg), None
    return Sentiment.neu, 0.0, 0.5, None


async def run_sentiment(
    session: AsyncSession, run_id: int | None = None, post_ids: list[int] | None = None
) -> dict:
    """Classify posts this stage has not seen yet."""
    own_run = run_id is None
    if own_run:
        run_id = await _stage.open_run(session, "sentiment")

    mode = "stub"  # updated below when the sidecar answered

    if post_ids is None:
        pending = await _stage.pending_posts(session, "sentiment")
    else:
        rows = await session.execute(
            select(Post.id, Post.body_text).where(Post.id.in_(post_ids))
        )
        pending = [(r[0], r[1] or "") for r in rows]

    counts = {"pos": 0, "neu": 0, "neg": 0}
    now = datetime.now(timezone.utc)
    done_by_version: dict[str, list[int]] = {}
    errors: list[str] = []
    failed = 0

    if pending:
        results, errors, failed, version = await _stage.analyse_texts(
            [t for _, t in pending], stub_sentiment, stage="sentiment"
        )
        mode = "laya-v1" if version == _stage.SIDECAR_VERSION else "stub"
        for (pid, _text), payload in zip(pending, results):
            if payload is None:
                continue
            sentiment, intensity, confidence, result_id = payload
            session.add(
                SentimentResult(
                    post_id=pid,
                    run_id=run_id,
                    model_version=version,
                    sentiment=sentiment,
                    intensity=intensity,
                    confidence=confidence,
                    aihub_result_id=result_id,
                    created_at=now,
                )
            )
            counts[sentiment.value] += 1
            done_by_version.setdefault(version, []).append(pid)
        for version, ids in done_by_version.items():
            await _stage.mark_analysed(session, "sentiment", ids, version)

    stored = sum(len(v) for v in done_by_version.values())
    stats = {
        "stage": "sentiment",
        "mode": mode,
        "posts": len(pending),
        "stored": stored,
        "failed": failed,
        **counts,
    }
    if errors:
        stats["errors"] = errors
    if failed and not stored and pending:
        stats["error"] = f"all {failed} sentiment calls failed: {errors[0][:300]}"

    if own_run:
        await _stage.close_run(session, run_id, stats, f"sentiment:{mode}")
        await session.commit()
    else:
        await session.flush()
    return stats

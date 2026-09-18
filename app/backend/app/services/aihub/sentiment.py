"""Sentiment classifier -> sentiment_results.

Real mode: a second AI Hub text classification model, same response shape as
priority (``output.category.name`` / ``.confidence``, per
ai-hub/integrate-apis-text-prediction). Intensity is not a field AI Hub
returns — it is derived from the winning class's confidence so real and stub
modes produce the same scale and the Overview KPI does not jump when tokens
are added.

Stub mode (no ``AIHUB_TOKEN_SENTIMENT``): deterministic lexicon, ``stub-1``.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Post, Sentiment, SentimentResult
from app.services.aihub import _stage
from app.services.aihub._stage import STUB_VERSION
from app.services.aihub.client import AIHubClient

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

LABEL_MAP = {
    "pos": Sentiment.pos,
    "positive": Sentiment.pos,
    "neu": Sentiment.neu,
    "neutral": Sentiment.neu,
    "neg": Sentiment.neg,
    "negative": Sentiment.neg,
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


def parse_result(payload: dict) -> tuple[Sentiment, float, float, str | None]:
    category = (payload.get("output") or {}).get("category") or {}
    label = str(category.get("name") or "").strip().lower()
    sentiment = LABEL_MAP.get(label)
    if sentiment is None:
        raise ValueError(
            f"AI Hub returned sentiment category {label!r}, which is not one of "
            f"{sorted(LABEL_MAP)} — check the labels the model was trained on"
        )
    try:
        confidence = float(category.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    # Neutral carries no signed magnitude; pos/neg use the model's own
    # confidence as intensity (same 0..1 scale the stub produces).
    intensity = 0.0 if sentiment is Sentiment.neu else confidence
    result_id = payload.get("_id") or payload.get("id")
    return sentiment, intensity, confidence, (str(result_id) if result_id else None)


def model_version(payload: dict | None) -> str:
    if not payload:
        return STUB_VERSION
    return str(payload.get("training_id") or payload.get("model_version") or "aihub-1")


async def run_sentiment(
    session: AsyncSession, run_id: int | None = None, post_ids: list[int] | None = None
) -> dict:
    """Classify posts this stage has not seen yet. Stub-safe."""
    own_run = run_id is None
    if own_run:
        run_id = await _stage.open_run(session, "sentiment")

    client = AIHubClient("sentiment", run_id=run_id)
    mode = "aihub" if client.is_configured else "stub"

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
        results, errors, failed = await _stage.analyse_texts(
            client, [t for _, t in pending], stub_sentiment
        )
        for (pid, _text), payload in zip(pending, results):
            if payload is None:
                continue
            try:
                if client.is_configured:
                    sentiment, intensity, confidence, result_id = parse_result(payload)
                    version = model_version(payload)
                else:
                    sentiment, intensity, confidence, result_id = payload
                    version = STUB_VERSION
            except ValueError as e:
                failed += 1
                if len(errors) < 10:
                    errors.append(str(e))
                continue
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

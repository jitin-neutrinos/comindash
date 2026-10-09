"""Priority classifier -> priority_results.

Served by the inference sidecar (Laya classifier, ``model_version="laya-v1"``);
the keyword heuristic below is the deterministic stub fallback
(``model_version="stub-1"``) used by tests and whenever the sidecar is down.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Post, Priority, PriorityResult
from app.services.analysis import _stage
from app.services.analysis._stage import STUB_VERSION

HIGH_KEYWORDS = [
    "urgent",
    "critical",
    "blocker",
    "crash",
    "data loss",
    "security",
    "outage",
    "cannot",
    "can't",
    "broken",
    "production",
    "deadlock",
]
MEDIUM_KEYWORDS = [
    "bug",
    "issue",
    "error",
    "slow",
    "failing",
    "fails",
    "confusing",
    "regression",
    "workaround",
    "unexpected",
]
LOW_KEYWORDS = [
    "question",
    "how to",
    "feature request",
    "nice to have",
    "docs",
    "documentation",
    "suggestion",
]

LABEL_MAP = {
    "high": Priority.high,
    "medium": Priority.medium,
    "med": Priority.medium,
    "low": Priority.low,
    "p1": Priority.high,
    "p2": Priority.medium,
    "p3": Priority.low,
}


def _count_hits(text: str, keywords: list[str]) -> int:
    lowered = (text or "").lower()
    return sum(1 for k in keywords if k in lowered)


def stub_priority(text: str) -> tuple[Priority, float, str | None]:
    """Deterministic keyword heuristic: (priority, confidence, result_id)."""
    high = _count_hits(text, HIGH_KEYWORDS)
    medium = _count_hits(text, MEDIUM_KEYWORDS)
    low = _count_hits(text, LOW_KEYWORDS)
    if high:
        return Priority.high, min(0.95, 0.65 + 0.1 * high), None
    if medium:
        return Priority.medium, min(0.9, 0.55 + 0.1 * medium), None
    return Priority.low, min(0.85, 0.4 + 0.15 * low), None


async def run_priority(
    session: AsyncSession, run_id: int | None = None, post_ids: list[int] | None = None
) -> dict:
    """Classify posts this stage has not seen yet."""
    own_run = run_id is None
    if own_run:
        run_id = await _stage.open_run(session, "priority")

    mode = "stub"  # updated below when the sidecar answered

    if post_ids is None:
        pending = await _stage.pending_posts(session, "priority")
    else:
        rows = await session.execute(
            select(Post.id, Post.body_text).where(Post.id.in_(post_ids))
        )
        pending = [(r[0], r[1] or "") for r in rows]

    counts = {"high": 0, "medium": 0, "low": 0}
    now = datetime.now(timezone.utc)
    done_by_version: dict[str, list[int]] = {}
    errors: list[str] = []
    failed = 0

    if pending:
        texts = [t for _, t in pending]
        results, errors, failed, version = await _stage.analyse_texts(
            texts, stub_priority, stage="priority"
        )
        mode = "laya-v1" if version == _stage.SIDECAR_VERSION else "stub"
        for (pid, _text), payload in zip(pending, results):
            if payload is None:
                continue
            priority, confidence, result_id = payload
            session.add(
                PriorityResult(
                    post_id=pid,
                    run_id=run_id,
                    model_version=version,
                    priority=priority,
                    confidence=confidence,
                    aihub_result_id=result_id,
                    created_at=now,
                )
            )
            counts[priority.value] += 1
            done_by_version.setdefault(version, []).append(pid)
        for version, ids in done_by_version.items():
            await _stage.mark_analysed(session, "priority", ids, version)

    stored = sum(len(v) for v in done_by_version.values())
    remaining = len(pending) - stored
    stats = {
        "stage": "priority",
        "mode": mode,
        "posts": len(pending),
        "stored": stored,
        "failed": failed,
        **counts,
    }
    if errors:
        stats["errors"] = errors
    if failed and not stored and pending:
        stats["error"] = f"all {failed} priority calls failed: {errors[0][:300]}"
    if remaining:
        stats["skipped"] = remaining

    if own_run:
        await _stage.close_run(session, run_id, stats, f"priority:{mode}")
        await session.commit()
    else:
        await session.flush()
    return stats

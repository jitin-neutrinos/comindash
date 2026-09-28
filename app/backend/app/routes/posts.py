"""GET /api/posts — paginated, filterable, per-post analysis badges."""

from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Post, Priority, PriorityResult, Sentiment, SentimentResult, Topic
from app.schemas import AnalysisBadge, PaginatedOut, PostOut

router = APIRouter(prefix="/api/posts", tags=["posts"])

# Ingested bodies carry literal "[code snippet omitted]" placeholders. In a
# two-line preview they crowd out the actual sentence, so they are dropped
# from the excerpt only — the stored body is untouched.
_NOISE = re.compile(r"\[code snippet omitted\]\s*")
_EXCERPT_CHARS = 320


def _excerpt(body: str | None) -> str:
    """First readable sentence-ish run of a post, for a list preview."""
    text = _NOISE.sub("", body or "")
    text = " ".join(text.split())
    if len(text) <= _EXCERPT_CHARS:
        return text
    # Cut on a word boundary so the preview never ends mid-word.
    cut = text[:_EXCERPT_CHARS].rsplit(" ", 1)[0]
    return f"{cut}…"


@router.get("", response_model=PaginatedOut)
async def list_posts(
    topic_id: int | None = Query(None),
    q: str | None = Query(None, description="body or topic-title substring"),
    priority: Literal["high", "medium", "low"] | None = Query(None),
    sentiment: Literal["pos", "neu", "neg"] | None = Query(None),
    sort: Literal["newest", "oldest"] = Query("newest"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedOut:
    prio_sub = select(
        PriorityResult.post_id.label("post_id"),
        PriorityResult.priority.label("priority"),
        PriorityResult.confidence.label("p_conf"),
        PriorityResult.model_version.label("model_version"),
        func.row_number()
        .over(
            partition_by=PriorityResult.post_id,
            order_by=PriorityResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    sent_sub = select(
        SentimentResult.post_id.label("post_id"),
        SentimentResult.sentiment.label("sentiment"),
        SentimentResult.intensity.label("intensity"),
        SentimentResult.confidence.label("s_conf"),
        func.row_number()
        .over(
            partition_by=SentimentResult.post_id,
            order_by=SentimentResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()

    stmt = (
        select(
            Post,
            prio_sub.c.priority,
            prio_sub.c.p_conf,
            prio_sub.c.model_version,
            sent_sub.c.sentiment,
            sent_sub.c.intensity,
            sent_sub.c.s_conf,
            Topic.title,
            Topic.slug,
            Topic.discourse_topic_id,
        )
        .outerjoin(prio_sub, (prio_sub.c.post_id == Post.id) & (prio_sub.c.rn == 1))
        .outerjoin(sent_sub, (sent_sub.c.post_id == Post.id) & (sent_sub.c.rn == 1))
        .outerjoin(Topic, Topic.id == Post.topic_id)
    )
    if topic_id:
        stmt = stmt.where(Post.topic_id == topic_id)
    if q:
        # Search the thread title as well as the body: on an explorer, people
        # look for the conversation they remember, not a phrase inside it.
        stmt = stmt.where(
            or_(Post.body_text.ilike(f"%{q}%"), Topic.title.ilike(f"%{q}%"))
        )
    if priority:
        stmt = stmt.where(prio_sub.c.priority == Priority(priority))
    if sentiment:
        stmt = stmt.where(sent_sub.c.sentiment == Sentiment(sentiment))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = await session.scalar(count_stmt) or 0
    order = (
        (Post.created_at.asc().nullslast(), Post.id.asc())
        if sort == "oldest"
        else (Post.created_at.desc().nullslast(), Post.id.desc())
    )
    rows = (
        await session.execute(stmt.order_by(*order).limit(limit).offset(offset))
    ).all()

    items = []
    for (
        post,
        pr,
        p_conf,
        model_version,
        sent,
        intensity,
        s_conf,
        t_title,
        t_slug,
        t_did,
    ) in rows:
        out = PostOut.model_validate(post)
        out.excerpt = _excerpt(post.body_text)
        out.topic_title = t_title or ""
        out.topic_slug = t_slug or ""
        out.topic_discourse_id = t_did
        out.analysis = AnalysisBadge(
            priority=pr.value if pr else None,
            priority_confidence=p_conf,
            sentiment=sent.value if sent else None,
            sentiment_intensity=intensity,
            sentiment_confidence=s_conf,
            model_version=model_version,
        )
        items.append(out)
    return PaginatedOut(items=items, total=total, limit=limit, offset=offset)


def _self_check() -> None:
    # Placeholder noise must not eat the preview.
    noisy = "Set the flag in [code snippet omitted] , or for one service."
    assert "[code snippet" not in _excerpt(noisy), _excerpt(noisy)
    assert _excerpt(noisy).startswith("Set the flag in"), _excerpt(noisy)

    # Whitespace collapses; short bodies pass through whole and unellipsised.
    assert _excerpt("  a\n\n  b  ") == "a b"
    assert not _excerpt("short body").endswith("…")
    assert _excerpt(None) == "" and _excerpt("") == ""

    # Long bodies are cut on a word boundary, never mid-word.
    long_body = " ".join(["alpha"] * 400)
    cut = _excerpt(long_body)
    assert len(cut) <= _EXCERPT_CHARS + 1, len(cut)
    assert cut.endswith("…") and "alph…" not in cut, cut

    print("posts route self-check OK")


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

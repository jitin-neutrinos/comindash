"""Per-stage analysis markers.

Regression cover for the defect that made the analyze stage re-process (and,
with real AI Hub tokens, re-bill) every post that legitimately produced no
result rows — 1076 of 2082 posts, every hour, forever.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select

from app.models import Extraction, Post, PriorityResult, Topic
from app.services.aihub._stage import clear_markers, pending_posts
from app.services.aihub.extraction import run_extraction
from app.services.aihub.priority import run_priority

NOW = datetime(2026, 9, 11, tzinfo=timezone.utc)


async def _seed(session, bodies: list[str]) -> list[int]:
    topic = Topic(forum_id=1, discourse_topic_id=1, title="t", slug="t")
    session.add(topic)
    await session.flush()
    ids = []
    for i, body in enumerate(bodies):
        post = Post(
            topic_id=topic.id,
            discourse_post_id=1000 + i,
            post_number=i + 1,
            body_text=body,
            created_at=NOW,
            ingested_at=NOW,
        )
        session.add(post)
        await session.flush()
        ids.append(post.id)
    return ids


async def test_zero_entity_post_is_not_reprocessed(session):
    """A post the NER stub finds nothing in must still be marked analysed."""
    # lowercase, no urls/versions/error codes => stub_ner returns []
    await _seed(session, ["ok thanks", "sure that works for me"])

    first = await run_extraction(session)
    assert first["posts"] == 2
    assert first["entities"] == 0
    assert first["analysed"] == 2, "posts with no entities must still be marked"

    second = await run_extraction(session)
    assert second["posts"] == 0, "already-analysed posts must not be re-selected"
    assert await session.scalar(select(func.count(Extraction.id))) == 0


async def test_analysed_posts_drop_out_of_the_pending_queue(session):
    await _seed(session, ["urgent crash in production", "how to configure this"])

    assert len(await pending_posts(session, "priority")) == 2
    await run_priority(session)
    assert await pending_posts(session, "priority") == []
    assert await session.scalar(select(func.count(PriorityResult.id))) == 2


async def test_clearing_markers_reopens_a_post(session):
    """An edited post must be re-analysed exactly once."""
    ids = await _seed(session, ["urgent crash in production"])
    await run_priority(session)
    assert await pending_posts(session, "priority") == []

    await clear_markers(session, ids)
    pending = await pending_posts(session, "priority")
    assert [p[0] for p in pending] == ids

    await run_priority(session)
    assert await pending_posts(session, "priority") == []
    # append-only history: the re-analysis adds a row, it does not overwrite
    assert await session.scalar(select(func.count(PriorityResult.id))) == 2

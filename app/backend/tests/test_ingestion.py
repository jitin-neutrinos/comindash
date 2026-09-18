"""Ingestion service: since-cursor, idempotent upserts, run bookkeeping.
Discourse HTTP fully respx-mocked."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import respx
from httpx import Response
from sqlalchemy import func, select

from app.models import IngestionState, PipelineRun, Post, RunStatus, Topic
from app.services.discourse import DiscourseAPIError, DiscourseClient
from app.services.ingestion import get_or_create_forum, run_ingest

BASE = "https://forum.test"
NOW = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)


def _topic_json(tid: int, title: str, age_hours: float) -> dict:
    ts = (NOW - timedelta(hours=age_hours)).isoformat()
    return {
        "id": tid,
        "title": title,
        "slug": title.lower().replace(" ", "-"),
        "category_id": 7,
        "created_at": ts,
        "last_posted_at": ts,
        "posts_count": 2,
        "views": 10,
        "like_count": 0,
    }


def _mock_discourse(older_hours: float = 72.0) -> None:
    """Two fresh topics (5h and 9h old) + one stale (beyond a 1-day cursor)."""
    respx.get(f"{BASE}/categories.json").respond(
        json={
            "category_list": {"categories": [{"id": 7, "name": "eng", "slug": "eng"}]}
        }
    )
    respx.get(f"{BASE}/latest.json").respond(
        json={
            "topic_list": {
                "topics": [
                    _topic_json(21, "Fresh pain", 5),
                    _topic_json(22, "Also fresh", 9),
                    _topic_json(23, "Stale topic", older_hours),
                ],
                "more_topics_url": None,
            }
        }
    )
    for tid, pids in ((21, [901, 902]), (22, [903])):
        respx.get(f"{BASE}/t/{tid}.json").respond(
            json={"post_stream": {"stream": pids, "posts": []}}
        )
        respx.get(f"{BASE}/t/{tid}/posts.json").respond(
            json={
                # real Discourse nests these under post_stream, same as
                # /t/{id}.json — a flat "posts" key never exists here
                "post_stream": {
                    "posts": [
                        {
                            "id": pid,
                            "post_number": i + 1,
                            "username": f"user{pid}",
                            "cooked": f"<p>Body of post {pid}</p>",
                            "created_at": (NOW - timedelta(hours=5)).isoformat(),
                            "updated_at": (NOW - timedelta(hours=5)).isoformat(),
                        }
                        for i, pid in enumerate(pids)
                    ]
                }
            }
        )


def _fast_client() -> DiscourseClient:
    return DiscourseClient(base_url=BASE, retry_wait_mult=0)


@respx.mock
async def test_ingest_creates_topics_posts_and_cursor(session):
    _mock_discourse()
    stats = await run_ingest(session=session, client=_fast_client())

    # first run has no cursor yet: all three topics are fetched (the stale
    # one included), but only topics 21/22 have posts mocked
    assert stats["topics_fetched"] == 3
    assert stats["posts_new"] == 3
    assert stats["mode"] == "public"  # no API key in test env

    assert await session.scalar(select(func.count(Topic.id))) == 3
    assert await session.scalar(select(func.count(Post.id))) == 3
    assert await session.scalar(select(func.count(PipelineRun.id))) == 1

    run = (await session.execute(select(PipelineRun))).scalar_one()
    assert run.kind.value == "ingest"
    assert run.status is RunStatus.done
    assert run.stats["posts_new"] == 3

    forum = await get_or_create_forum(session)
    assert forum.cursor_state["since_cursor"] is not None
    assert forum.last_ingested_at is not None

    state = (await session.execute(select(IngestionState))).scalar_one()
    assert state.status == "done"
    assert state.pages_done == 1


@respx.mock
async def test_second_ingest_is_idempotent(session):
    _mock_discourse()
    await run_ingest(session=session, client=_fast_client())
    stats2 = await run_ingest(session=session, client=_fast_client())

    # cursor now sits at the newest last_posted_at (5h old); all mocked topics
    # are ≤ that, so nothing new is fetched and upserts rewrite the same rows
    assert stats2["topics_fetched"] == 0
    assert stats2["posts_new"] == 0
    assert await session.scalar(select(func.count(Post.id))) == 3
    assert await session.scalar(select(func.count(Topic.id))) == 3


@respx.mock
async def test_failure_marks_run_failed(session):
    respx.get(f"{BASE}/categories.json").respond(
        json={"category_list": {"categories": []}}
    )
    respx.get(f"{BASE}/latest.json").respond(status_code=500)

    # the run is recorded as failed AND the error propagates, so the worker
    # fails the job and the queue's retry/backoff engages. Swallowing it used
    # to mark the job done and silently lose the run.
    with pytest.raises(DiscourseAPIError):
        await run_ingest(session=session, client=_fast_client())

    run = (await session.execute(select(PipelineRun))).scalar_one()
    assert run.status is RunStatus.failed
    assert run.error


async def test_get_or_create_forum_idempotent(session):
    a = await get_or_create_forum(session, "https://x.test")
    b = await get_or_create_forum(session, "https://x.test/")
    assert a.id == b.id

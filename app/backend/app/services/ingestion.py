"""Since-cursor ingestion: topics + ALL posts (replies included), idempotent
upserts keyed on Discourse ids."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    Forum,
    IngestionState,
    PipelineRun,
    Post,
    RunKind,
    RunStatus,
    Topic,
)
from app.services.analysis._stage import clear_markers
from app.services.database_session import get_run_session  # re-exported helper
from app.services.discourse import DiscourseClient, as_utc

logger = logging.getLogger("ingestion")


def _cursor_dt(forum: Forum) -> datetime | None:
    raw = (forum.cursor_state or {}).get("since_cursor")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw))
    except ValueError:
        return None


async def _upsert_topic(session: AsyncSession, forum_id: int, t: dict) -> Topic:
    row = await session.execute(
        select(Topic).where(Topic.discourse_topic_id == t["discourse_topic_id"])
    )
    topic = row.scalar_one_or_none()
    if topic is None:
        topic = Topic(forum_id=forum_id, discourse_topic_id=t["discourse_topic_id"])
        session.add(topic)
    topic.title = t.get("title", "")
    topic.category = t.get("category", "")
    topic.slug = t.get("slug", "")
    topic.created_at = as_utc(t.get("created_at"))
    topic.last_posted_at = as_utc(t.get("last_posted_at"))
    topic.posts_count = t.get("posts_count", 0)
    topic.views = t.get("views", 0)
    topic.like_count = t.get("like_count", 0)
    await session.flush()
    return topic


async def _upsert_post(session: AsyncSession, topic_id: int, p: dict) -> str:
    """Insert or refresh a post. Returns "new", "edited" or "unchanged".

    "edited" matters: the body text changed, so the stored analysis is stale and
    the post must be re-opened for the analysis stages.
    """
    row = await session.execute(
        select(Post).where(Post.discourse_post_id == p["discourse_post_id"])
    )
    post = row.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if post is None:
        session.add(
            Post(
                topic_id=topic_id,
                discourse_post_id=p["discourse_post_id"],
                post_number=p.get("post_number", 1),
                author_hash=p.get("author_hash", ""),
                body_text=p.get("body_text", ""),
                language="en",
                created_at=as_utc(p.get("created_at")),
                updated_at=as_utc(p.get("updated_at")),
                ingested_at=now,
            )
        )
        return "new"
    new_body = p.get("body_text", post.body_text)
    edited = new_body != post.body_text
    post.post_number = p.get("post_number", post.post_number)
    post.author_hash = p.get("author_hash", post.author_hash)
    post.body_text = new_body
    post.updated_at = as_utc(p.get("updated_at")) or post.updated_at
    return "edited" if edited else "unchanged"


async def get_or_create_forum(
    session: AsyncSession, base_url: str | None = None
) -> Forum:
    url = (base_url or get_settings().discourse_base_url).rstrip("/")
    row = await session.execute(select(Forum).where(Forum.base_url == url))
    forum = row.scalar_one_or_none()
    if forum is None:
        name = url.split("//")[-1].split("/")[0]
        forum = Forum(base_url=url, name=name)
        session.add(forum)
        await session.flush()
    return forum


async def _ingest_topic_posts(
    session: AsyncSession, topic_id: int, posts: list[dict]
) -> tuple[int, int, list[int]]:
    """Upsert one topic's posts. Returns (new, updated, edited_ids)."""
    new = updated = 0
    edited_ids: list[int] = []
    for p in posts:
        outcome = await _upsert_post(session, topic_id, p)
        if outcome == "new":
            new += 1
            continue
        updated += 1
        if outcome == "edited":
            existing = await session.scalar(
                select(Post.id).where(Post.discourse_post_id == p["discourse_post_id"])
            )
            if existing is not None:
                edited_ids.append(existing)
    return new, updated, edited_ids


async def run_ingest(
    session: AsyncSession | None = None,
    forum_id: int | None = None,
    triggered_by: str = "manual",
    client: DiscourseClient | None = None,
) -> dict:
    """One incremental ingest pass. Opens its own session when called from the
    worker/scheduler (no session in the payload)."""
    if session is None:
        async with get_run_session() as s:
            return await run_ingest(s, forum_id=forum_id, triggered_by=triggered_by)

    now = datetime.now(timezone.utc)
    client = client or DiscourseClient()

    if forum_id is not None:
        forum = await session.get(Forum, forum_id)
        if forum is None:
            raise ValueError(f"forum {forum_id} not found")
    else:
        forum = await get_or_create_forum(session)

    run = PipelineRun(
        kind=RunKind.ingest,
        status=RunStatus.running,
        started_at=now,
        triggered_by=triggered_by,
    )
    session.add(run)
    state = IngestionState(forum_id=forum.id, status="running", started_at=now)
    session.add(state)
    await session.flush()

    stats: dict = {"stage": "ingest"}
    try:
        since = _cursor_dt(forum)
        state.since_cursor = since.isoformat() if since else None
        topics, pages_done, truncated = await client.fetch_topics_since(since)
        state.pages_done = pages_done

        posts_by_topic, topic_failures = await client.fetch_all_posts(
            [t["discourse_topic_id"] for t in topics]
        )

        new_posts = 0
        updated_posts = 0
        edited_ids: list[int] = []
        for t in topics:
            topic = await _upsert_topic(session, forum.id, t)
            n_new, n_upd, n_edited = await _ingest_topic_posts(
                session, topic.id, posts_by_topic.get(t["discourse_topic_id"], [])
            )
            new_posts += n_new
            updated_posts += n_upd
            edited_ids.extend(n_edited)

        # an edited post's stored priority/sentiment/entities describe text that
        # no longer exists — re-open it for the analysis stages
        await clear_markers(session, edited_ids)

        newest = max(
            (t["last_posted_at"] for t in topics if t.get("last_posted_at")),
            default=None,
        )
        # Never advance the cursor off a partial pass: the pages we did not
        # fetch would become permanently unreachable.
        if newest is not None and not truncated:
            cursor_iso = newest.isoformat()
            forum.cursor_state = {
                **(forum.cursor_state or {}),
                "since_cursor": cursor_iso,
            }
            state.since_cursor = cursor_iso
        forum.last_ingested_at = now

        stats = {
            "stage": "ingest",
            "mode": "api_key" if client.api_key else "public",
            "pass": "backfill" if since is None else "incremental",
            "topics_fetched": len(topics),
            "posts_new": new_posts,
            "posts_updated": updated_posts,
            "posts_reopened": len(edited_ids),
            "topics_failed": len(topic_failures),
            "pages": pages_done,
            "truncated": truncated,
        }
        if topic_failures:
            # failure reasons stay bounded: first few, then a count
            sample = list(topic_failures.items())[:3]
            stats["topic_failures"] = {
                str(tid): reason for tid, reason in sample
            }
        run.status = RunStatus.done
        state.status = "done"
    except Exception as e:  # noqa: BLE001 — recorded on the run, then re-raised
        stats = {"stage": "ingest", "error": str(e)[:500]}
        run.status = RunStatus.failed
        run.error = str(e)[:2000]
        state.status = "failed"
        run.finished_at = datetime.now(timezone.utc)
        state.finished_at = run.finished_at
        run.stats = stats
        await session.commit()
        logger.exception("ingest failed")
        # re-raise so the worker fails the job and the queue retries with
        # backoff; swallowing this marked the job done and lost the run
        raise

    run.finished_at = datetime.now(timezone.utc)
    state.finished_at = run.finished_at
    run.stats = stats
    await session.commit()
    return stats

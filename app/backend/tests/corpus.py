"""Deterministic fixture corpus + seed helpers.

Post bodies are chosen so the stub analyzers produce known results:
- POST_BODIES[0]: high priority (crash/critical/blocker), neg sentiment,
  an ERROR_CODE entity
- POST_BODIES[1]: medium priority (issue), pos sentiment (works/great/thanks)
- POST_BODIES[2]: low priority (question/docs), neutral sentiment
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Forum, Post, Topic

NOW = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)

FORUM_URL = "https://forum.test"

TOPICS = [
    {
        "discourse_topic_id": 11,
        "title": "Debugger crashes on large projects",
        "slug": "debugger-crashes-on-large-projects",
        "category": "engineering",
        "created_at": NOW - timedelta(days=2),
        "last_posted_at": NOW - timedelta(hours=5),
    },
    {
        "discourse_topic_id": 12,
        "title": "Deployment connectors guide",
        "slug": "deployment-connectors-guide",
        "category": "how-to",
        "created_at": NOW - timedelta(days=10),
        "last_posted_at": NOW - timedelta(days=1),
    },
    {
        "discourse_topic_id": 13,
        "title": "Question about API docs",
        "slug": "question-about-api-docs",
        "category": "how-to",
        "created_at": NOW - timedelta(days=1),
        "last_posted_at": NOW - timedelta(hours=2),
    },
]

POST_BODIES = [
    "The Debugger crashes every time I open a large project. This is a "
    "critical blocker for our team. See ERROR-4021 on version 6.2.1.",
    "Thanks, this works great now! Solved our deployment issue with the "
    "connector pipeline at https://docs.example.com/setup.",
    "How to configure the API connector? Just a question about the docs.",
]

# one (post_number, body) list per topic, discourse post ids are globally unique
POSTS_BY_TOPIC = {
    11: [(101, POST_BODIES[0], "alice"), (102, POST_BODIES[2], "bob")],
    12: [(201, POST_BODIES[1], "carol")],
    13: [(301, POST_BODIES[2], "dave")],
}


async def seed_corpus(session: AsyncSession) -> dict:
    """Seed forum + topics + posts; returns {'forum_id', 'topic_ids', 'post_ids'}."""
    forum = Forum(base_url=FORUM_URL, name="forum.test", cursor_state={})
    session.add(forum)
    await session.flush()

    topic_ids: dict[int, int] = {}
    post_ids: list[int] = []
    for t in TOPICS:
        topic = Topic(
            forum_id=forum.id,
            discourse_topic_id=t["discourse_topic_id"],
            title=t["title"],
            slug=t["slug"],
            category=t["category"],
            created_at=t["created_at"],
            last_posted_at=t["last_posted_at"],
            posts_count=len(POSTS_BY_TOPIC[t["discourse_topic_id"]]),
            views=100,
            like_count=3,
        )
        session.add(topic)
        await session.flush()
        topic_ids[t["discourse_topic_id"]] = topic.id

        for i, (dp_id, body, author) in enumerate(
            POSTS_BY_TOPIC[t["discourse_topic_id"]], start=1
        ):
            post = Post(
                topic_id=topic.id,
                discourse_post_id=dp_id,
                post_number=i,
                author_hash=author,
                body_text=body,
                language="en",
                created_at=t["last_posted_at"] - timedelta(minutes=10 * i),
                updated_at=t["last_posted_at"],
                ingested_at=NOW,
            )
            session.add(post)
            await session.flush()
            post_ids.append(post.id)

    await session.commit()
    return {"forum_id": forum.id, "topic_ids": topic_ids, "post_ids": post_ids}

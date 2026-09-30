import json
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models import Post, Topic, PriorityResult, SentimentResult, Priority, Sentiment

POSTS_PER_CHUNK = 200

async def fetch_ranked_posts(session: Session) -> list:
    """Fetch and rank non-empty posts."""
    # join topic, priority, sentiment
    # ordered priority == high desc, sentiment == neg desc, created_at desc nullslast
    from sqlalchemy.future import select
    from sqlalchemy.orm import aliased
    

    # Need to be async.
    query = (
        select(Post, Topic, PriorityResult, SentimentResult)
        .join(Topic, Post.topic_id == Topic.id)
        .outerjoin(PriorityResult, Post.id == PriorityResult.post_id)
        .outerjoin(SentimentResult, Post.id == SentimentResult.post_id)
        .where(func.length(func.trim(func.coalesce(Post.body_text, ''))) > 0)
        .order_by(
            (PriorityResult.priority == Priority.high).desc(),
            (SentimentResult.sentiment == Sentiment.neg).desc(),
            Post.created_at.desc().nullslast()
        )
    )
    result = await session.execute(query)
    
    deduped = []
    seen = set()
    for row in result.all():
        if row.Post.id not in seen:
            seen.add(row.Post.id)
            deduped.append(row)
    return deduped


def make_chunks(rows: list, posts_per_chunk: int = POSTS_PER_CHUNK) -> list[list]:
    chunks = [rows[i:i + posts_per_chunk] for i in range(0, len(rows), posts_per_chunk)]
    # Assert exact partition
    assert sum(len(c) for c in chunks) == len(rows)
    seen_ids = set()
    for chunk in chunks:
        for row in chunk:
            post = row.Post
            assert post.id not in seen_ids
            seen_ids.add(post.id)
    return chunks

def render_chunk(posts: list) -> str:
    out = []
    for row in posts:
        post = row.Post
        topic = row.Topic
        prio = row.PriorityResult
        sent = row.SentimentResult
        
        # text[:280]
        text_content = (post.body_text or "")[:280]
        
        out.append({
            "discourse_post_id": post.discourse_post_id,
            "topic": topic.title,
            "category": topic.category,
            "priority": (prio.priority.value if hasattr(prio.priority, "value") else str(prio.priority)) if prio else None,
            "sentiment": (sent.sentiment.value if hasattr(sent.sentiment, "value") else str(sent.sentiment)) if sent else None,
            "text": text_content
        })
    return json.dumps(out)

if __name__ == "__main__":
    import asyncio
    import sys
    from app.database import get_engine
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlalchemy.ext.asyncio import AsyncSession

    async def main():
        
        async with async_sessionmaker(get_engine())() as session:
            rows = await fetch_ranked_posts(session)
            chunks = make_chunks(rows)
            print(f"Total posts: {len(rows)}")
            print(f"Total chunks: {len(chunks)}")
            if chunks:
                print(f"Sample chunk 0 length: {len(chunks[0])}")
        
    asyncio.run(main())
    sys.exit(0)

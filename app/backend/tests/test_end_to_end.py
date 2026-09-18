"""End-to-end: mock Discourse → ingest → stub analysis → assistant skip →
API queries. Zero external calls (respx + stub mode)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import respx

from app.models import (
    AssistantInsight,
    Extraction,
    InsightStatus,
    PriorityResult,
    SentimentResult,
)
from app.services.aggregator import run_aggregation
from app.services.aihub.assistant import run_assistant_cycle
from app.services.ingestion import run_ingest
from app.services.discourse import DiscourseClient
from sqlalchemy import func, select
from tests.conftest import INGEST_TOKEN

BASE = "https://forum.test"
NOW = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)


def _mock_forum() -> None:
    respx.get(f"{BASE}/categories.json").respond(
        json={
            "category_list": {
                "categories": [{"id": 4, "name": "support", "slug": "support"}]
            }
        }
    )
    respx.get(f"{BASE}/latest.json").respond(
        json={
            "topic_list": {
                "topics": [
                    {
                        "id": 71,
                        "title": "Studio export broken",
                        "slug": "studio-export-broken",
                        "category_id": 4,
                        "created_at": (NOW - timedelta(hours=3)).isoformat(),
                        "last_posted_at": (NOW - timedelta(hours=2)).isoformat(),
                        "posts_count": 2,
                        "views": 40,
                        "like_count": 2,
                    }
                ],
                "more_topics_url": None,
            }
        }
    )
    respx.get(f"{BASE}/t/71.json").respond(
        json={"post_stream": {"stream": [801, 802], "posts": []}}
    )
    respx.get(f"{BASE}/t/71/posts.json").respond(
        json={
            # real Discourse nests these under post_stream, same as
            # /t/{id}.json — a flat "posts" key never exists here
            "post_stream": {
                "posts": [
                    {
                        "id": 801,
                        "post_number": 1,
                        "username": "alice",
                        "cooked": "<p>The Studio export is broken and crashes with ERR-77 on version 5.1. Critical blocker!</p>",
                        "created_at": (NOW - timedelta(hours=3)).isoformat(),
                        "updated_at": (NOW - timedelta(hours=3)).isoformat(),
                    },
                    {
                        "id": 802,
                        "post_number": 2,
                        "username": "bob",
                        "cooked": "<p>Thanks for the workaround, works great now.</p>",
                        "created_at": (NOW - timedelta(hours=2)).isoformat(),
                        "updated_at": (NOW - timedelta(hours=2)).isoformat(),
                    },
                ]
            }
        }
    )


@respx.mock
async def test_full_stub_pipeline(client, session):
    _mock_forum()
    client_http = DiscourseClient(base_url=BASE, retry_wait_mult=0)

    # 1. ingest
    ingest_stats = await run_ingest(session=session, client=client_http)
    assert ingest_stats["posts_new"] == 2
    assert ingest_stats["mode"] == "stub" or ingest_stats["mode"] == "public"

    # 2. analyze (all stubs)
    agg_stats = await run_aggregation(session=session)
    assert agg_stats["extraction"]["mode"] == "stub"
    assert agg_stats["priority"]["mode"] == "stub"
    assert agg_stats["sentiment"]["mode"] == "stub"

    assert await session.scalar(select(func.count(PriorityResult.id))) == 2
    assert await session.scalar(select(func.count(SentimentResult.id))) == 2
    assert await session.scalar(select(func.count(Extraction.id))) >= 1
    assert agg_stats["topics_rolled_up"] == 1

    # 3. assistant cycle without token → skip, no crash
    assistant_stats = await run_assistant_cycle(session=session)
    assert assistant_stats["mode"] == "skipped"

    # 4. assistant connector pushes an insight through the gated API
    payload = {
        "assistant_version": "v1",
        "run_ref": "e2e",
        "insights": [
            {
                "insight_type": "pain_point",
                "title": "Studio export crashes",
                "body": "Export failures with ERR-77 cluster",
                "severity": "high",
                "evidence": [
                    {
                        "discourse_post_id": 801,
                        "quote": "The Studio export is broken and crashes",
                        "relevance_note": "primary report",
                    }
                ],
                "relationships": [
                    {
                        "subject_type": "entity",
                        "subject_value": "Studio",
                        "relation": "correlates_with",
                        "object_type": "topic",
                        "object_value": "export",
                        "strength": 0.9,
                    }
                ],
            }
        ],
    }
    r = await client.post(
        "/api/insights/ingest", json=payload, headers={"X-Ingest-Token": INGEST_TOKEN}
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 1

    # 5. the dashboard reads it all back
    health = (await client.get("/api/health")).json()
    assert set(health["last_run"]) == {"ingest", "analyze", "assistant"}

    overview = (await client.get("/api/overview")).json()
    assert overview["total_posts"] == 2
    assert overview["high_priority_count"] == 1
    assert overview["active_pain_points"] == 1

    pain = (await client.get("/api/pain-points")).json()
    assert len(pain) == 1
    assert pain[0]["severity"] == "high"

    detail = (await client.get(f"/api/insights/{r.json()['insight_ids'][0]}")).json()
    assert detail["evidence"][0]["discourse_post_id"] == 801
    assert detail["relationships"][0]["subject_value"] == "Studio"

    graph = (await client.get("/api/relationships")).json()
    assert any(e["strength"] == 0.9 for e in graph["edges"])

    volume = (
        await client.get("/api/trends", params={"metric": "volume", "days": 7})
    ).json()
    assert sum(p["value"] for p in volume) == 2

    posts = (await client.get("/api/posts", params={"priority": "high"})).json()
    assert posts["total"] == 1
    assert posts["items"][0]["analysis"]["priority"] == "high"

    runs = (await client.get("/api/runs")).json()
    assert runs["total"] >= 3

    csv_export = await client.get("/api/export.csv", params={"dataset": "posts"})
    assert csv_export.status_code == 200

    # 6. insight is active in the DB
    insights = (await session.execute(select(AssistantInsight))).scalars().all()
    assert all(i.status is InsightStatus.active for i in insights)

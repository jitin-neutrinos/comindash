"""API surface: every endpoint, filters, pagination, exports."""

from __future__ import annotations

import csv
import io

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.analysis.extraction import run_extraction
from app.services.analysis.priority import run_priority
from app.services.analysis.sentiment import run_sentiment
from tests.conftest import INGEST_TOKEN
from tests.corpus import seed_corpus


async def _seed_with_analysis(session: AsyncSession) -> dict:
    seeded = await seed_corpus(session)
    await run_priority(session)
    await run_sentiment(session)
    await run_extraction(session)
    return seeded


class TestHealth:
    async def test_health_ok(self, client):
        r = await client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["db"] == "ok"
        assert body["scheduler"] == "disabled"
        assert body["last_run"] == {}

    async def test_root(self, client):
        r = await client.get("/")
        assert r.status_code == 200
        assert r.json()["service"] == "community-insights"


class TestOverview:
    async def test_kpis(self, client, session):
        await _seed_with_analysis(session)
        r = await client.get("/api/overview")
        assert r.status_code == 200
        body = r.json()
        assert body["total_posts"] == 4
        assert body["total_topics"] == 3
        assert body["high_priority_count"] == 1  # corpus post 1 is the high one
        assert 0.0 < body["model_confidence"] <= 1.0
        # deterministic stub values: neg(-0.4) + pos(+0.6) over 4 posts
        assert body["avg_sentiment"] == pytest.approx(0.05)
        assert "pipeline_health" in body


class TestTopics:
    async def test_list_and_filters(self, client, session):
        await seed_corpus(session)
        r = await client.get("/api/topics")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 3
        assert len(body["items"]) == 3

        r = await client.get("/api/topics", params={"q": "debugger"})
        assert r.json()["total"] == 1

        r = await client.get("/api/topics", params={"category": "how-to"})
        assert r.json()["total"] == 2

        r = await client.get("/api/topics", params={"limit": 1, "offset": 1})
        assert len(r.json()["items"]) == 1
        assert r.json()["total"] == 3


class TestPosts:
    async def test_badges_present(self, client, session):
        await _seed_with_analysis(session)
        r = await client.get("/api/posts")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 4
        for item in body["items"]:
            assert item["analysis"]["model_version"] == "stub-1"
            assert item["analysis"]["priority"] in {"high", "medium", "low"}
            assert item["analysis"]["sentiment"] in {"pos", "neu", "neg"}

    async def test_filters(self, client, session):
        seeded = await _seed_with_analysis(session)
        r = await client.get("/api/posts", params={"topic_id": seeded["topic_ids"][11]})
        assert r.json()["total"] == 2

        r = await client.get("/api/posts", params={"q": "blocker"})
        assert r.json()["total"] == 1

        r = await client.get("/api/posts", params={"priority": "high"})
        assert r.json()["total"] == 1

        r = await client.get("/api/posts", params={"sentiment": "pos"})
        assert r.json()["total"] == 1

    async def test_bad_filter_value_422(self, client, session):
        await seed_corpus(session)
        r = await client.get("/api/posts", params={"priority": "urgent"})
        assert r.status_code == 422


class TestTrends:
    async def test_all_metrics(self, client, session):
        await _seed_with_analysis(session)
        for metric in ("volume", "priority", "sentiment", "entity"):
            r = await client.get("/api/trends", params={"metric": metric, "days": 30})
            assert r.status_code == 200, metric
            points = r.json()
            assert isinstance(points, list)
        r = await client.get("/api/trends", params={"metric": "priority"})
        assert r.status_code == 200
        assert all("extra" in p for p in r.json())

    async def test_unknown_metric_422(self, client):
        r = await client.get("/api/trends", params={"metric": "vibes"})
        assert r.status_code == 422


class TestRuns:
    async def test_run_history(self, client, session):
        await run_priority(session)
        await seed_corpus(session)
        await run_priority(session)
        r = await client.get("/api/runs")
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        assert body["items"][0]["kind"] == "analyze"

    async def test_kind_filter(self, client, session):
        await run_priority(session)
        r = await client.get("/api/runs", params={"kind": "ingest"})
        assert r.json()["total"] == 0
        r = await client.get("/api/runs", params={"kind": "bogus"})
        assert r.status_code == 422


class TestExports:
    async def test_datasets(self, client, session):
        await _seed_with_analysis(session)
        for dataset in (
            "posts",
            "topics",
            "insights",
            "priority",
            "sentiment",
            "evidence",
        ):
            r = await client.get("/api/export.csv", params={"dataset": dataset})
            assert r.status_code == 200, dataset
            assert r.headers["content-type"].startswith("text/csv")
            rows = list(csv.reader(io.StringIO(r.text)))
            assert rows[0][0] == "id"  # header row always present
            if dataset in {"posts", "topics", "priority", "sentiment"}:
                assert len(rows) >= 2, dataset

    async def test_unknown_dataset_422(self, client):
        r = await client.get("/api/export.csv", params={"dataset": "secrets"})
        assert r.status_code == 422

    async def test_posts_export_content(self, client, session):
        await seed_corpus(session)
        r = await client.get("/api/export.csv", params={"dataset": "posts"})
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0][0] == "id"
        assert len(rows) == 5  # header + 4 posts


class TestInsightsRoutes:
    async def _ingest_one(self, client) -> int:
        payload = {
            "assistant_version": "v1",
            "run_ref": "api-test",
            "insights": [
                {
                    "insight_type": "pain_point",
                    "title": "Connector config pain",
                    "body": "Users struggle",
                    "severity": "medium",
                    "evidence": [
                        {
                            "discourse_post_id": 301,
                            "quote": "How to configure",
                            "relevance_note": "confusion",
                        }
                    ],
                }
            ],
        }
        r = await client.post(
            "/api/insights/ingest",
            json=payload,
            headers={"X-Ingest-Token": INGEST_TOKEN},
        )
        assert r.status_code == 200
        return r.json()["insight_ids"][0]

    async def test_detail_404(self, client):
        r = await client.get("/api/insights/9999")
        assert r.status_code == 404

    async def test_bad_type_filter_422(self, client):
        r = await client.get("/api/insights", params={"insight_type": "vibe"})
        assert r.status_code == 422

    async def test_list_detail_painpoints_relationships(self, client, session):
        await seed_corpus(session)
        insight_id = await self._ingest_one(client)

        r = await client.get("/api/insights")
        body = r.json()
        assert len(body) == 1
        assert body[0]["evidence_count"] == 1
        assert body[0]["severity"] == "medium"

        r = await client.get(f"/api/insights/{insight_id}")
        assert r.status_code == 200
        detail = r.json()
        assert detail["evidence"][0]["discourse_post_id"] == 301
        assert detail["evidence"][0]["url"] == (
            "https://community.neutrinos.com/t/question-about-api-docs/13/301"
        )

        r = await client.get("/api/pain-points")
        assert [c["id"] for c in r.json()] == [insight_id]

        # no relationships ingested → empty graph.
        # The default view is the knowledge graph (which also aggregates
        # extractions); the legacy asserted-only shape lives at ?view=asserted.
        r = await client.get("/api/relationships", params={"view": "asserted"})
        assert r.json() == {"nodes": [], "edges": []}

    async def test_relationship_graph(self, client, session):
        await seed_corpus(session)
        payload = {
            "assistant_version": "v1",
            "run_ref": "rel-test",
            "insights": [
                {
                    "insight_type": "relationship",
                    "title": "Debugger ↔ deployment",
                    "severity": "low",
                    "evidence": [
                        {"discourse_post_id": 101, "quote": "q", "relevance_note": "n"}
                    ],
                    "relationships": [
                        {
                            "subject_type": "entity",
                            "subject_value": "Debugger",
                            "relation": "correlates_with",
                            "object_type": "topic",
                            "object_value": "deployment",
                            "strength": 0.8,
                        }
                    ],
                }
            ],
        }
        r = await client.post(
            "/api/insights/ingest",
            json=payload,
            headers={"X-Ingest-Token": INGEST_TOKEN},
        )
        assert r.status_code == 200
        # Default view = knowledge graph. Asserted relationships land as
        # kind="asserted" edges whose weight carries the model's strength;
        # the endpoints resolve onto graph nodes when they name entities.
        g = (await client.get("/api/relationships")).json()
        asserted = [e for e in g["edges"] if e["kind"] == "asserted"]
        assert len(asserted) == 1
        assert asserted[0]["weight"] == 0.8
        node_ids = {n["id"] for n in g["nodes"]}
        assert asserted[0]["source"] in node_ids
        assert asserted[0]["target"] in node_ids


class TestJobs:
    async def test_enqueue_claim_complete(self, session):
        from sqlalchemy import select

        from app.models import Job, JobStatus
        from app.services.jobs import (
            backoff_delay_s,
            claim_next,
            complete_job,
            enqueue,
            fail_job,
            watchdog,
        )

        job = await enqueue(session, "ingest", {"forum_id": 1})
        assert job is not None and job.status is JobStatus.pending

        # dedupe: second enqueue of same kind while pending is a no-op
        assert await enqueue(session, "ingest", {}) is None

        claimed = await claim_next(session, worker_id="w1")
        assert claimed is not None
        assert claimed.id == job.id
        assert claimed.status is JobStatus.running
        assert claimed.attempts == 1
        assert claimed.locked_by == "w1"
        await complete_job(session, job.id)

        fresh = await session.get(Job, job.id)
        assert fresh.status is JobStatus.done

    async def test_fail_retry_and_deadletter(self, session):
        from app.models import Job, JobStatus
        from app.services.jobs import enqueue, fail_job

        job = await enqueue(session, "analyze", {}, dedupe=False)
        assert job is not None
        status = await fail_job(session, job.id, attempts=1, error="boom")
        assert status is JobStatus.pending
        fresh = await session.get(Job, job.id)
        assert fresh.next_retry_at is not None
        assert fresh.error == "boom"

        status = await fail_job(session, job.id, attempts=5, error="boom again")
        assert status is JobStatus.dead

    async def test_watchdog_requeues_stale(self, session):
        from datetime import datetime, timedelta, timezone

        from app.models import Job, JobStatus
        from app.services.jobs import enqueue, watchdog

        job = await enqueue(session, "ingest", {}, dedupe=False)
        assert job is not None
        row = await session.get(Job, job.id)
        row.status = JobStatus.running
        row.locked_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await session.commit()

        requeued = await watchdog(session)
        assert requeued == 1
        fresh = await session.get(Job, job.id)
        assert fresh.status is JobStatus.pending

    def test_backoff_growth_and_cap(self):
        from app.services.jobs import BACKOFF_CAP_S, backoff_delay_s

        assert backoff_delay_s(1) == 30.0
        assert backoff_delay_s(3) == 120.0
        assert backoff_delay_s(50) == BACKOFF_CAP_S

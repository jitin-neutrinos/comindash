"""Aggregator: priority vote math, rollups, daily aggregates, orchestration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models import PipelineRun, Priority, PriorityResult, RunKind, RunStatus
from app.services.aggregator import (
    daily_aggregates,
    run_aggregation,
    topic_priority_rollups,
    vote_priority,
)
from tests.corpus import NOW, seed_corpus

UTC = timezone.utc


class TestVotePriority:
    def test_recency_decay_pulls_old_high_down(self):
        now = datetime(2026, 9, 9, tzinfo=UTC)
        label, score = vote_priority(
            [
                (Priority.high, 0.8, now - timedelta(days=28)),  # decay 0.25
                (Priority.low, 0.8, now),  # decay 1.0
            ],
            now=now,
        )
        # weights 0.2 vs 0.8 → score 0.2 → low
        assert label == "low"
        assert abs(score - 0.2) < 0.001

    def test_recent_high_wins(self):
        now = datetime(2026, 9, 9, tzinfo=UTC)
        label, score = vote_priority(
            [
                (Priority.high, 0.9, now),
                (Priority.low, 0.9, now - timedelta(days=28)),
            ],
            now=now,
        )
        assert label == "high"

    def test_confidence_weighting(self):
        now = datetime(2026, 9, 9, tzinfo=UTC)
        label, score = vote_priority(
            [
                (Priority.high, 0.3, now),
                (Priority.low, 0.9, now),
            ],
            now=now,
        )
        # 0.3 vs 0.9 → 0.25 → low
        assert label == "low"
        assert abs(score - 0.25) < 0.001

    def test_medium_boundary(self):
        now = datetime(2026, 9, 9, tzinfo=UTC)
        label, _ = vote_priority([(Priority.medium, 0.9, now)], now=now)
        assert label == "medium"

    def test_empty(self):
        assert vote_priority([]) == ("low", 0.0)


class TestRollups:
    async def test_topic_rollup_uses_latest_result_per_post(self, session):
        seeded = await seed_corpus(session)
        from app.models import PipelineRun

        run = PipelineRun(
            kind=RunKind.analyze,
            status=RunStatus.done,
            started_at=NOW,
            finished_at=NOW,
            stats={},
            triggered_by="test",
        )
        session.add(run)
        await session.flush()

        p1, p2 = seeded["post_ids"][0], seeded["post_ids"][1]
        # post 1: early low result superseded by a recent high one
        session.add(
            PriorityResult(
                post_id=p1,
                run_id=run.id,
                model_version="stub-1",
                priority=Priority.low,
                confidence=0.9,
                created_at=NOW - timedelta(days=30),
            )
        )
        session.add(
            PriorityResult(
                post_id=p1,
                run_id=run.id,
                model_version="stub-1",
                priority=Priority.high,
                confidence=0.9,
                created_at=NOW,
            )
        )
        # post 2: recent low
        session.add(
            PriorityResult(
                post_id=p2,
                run_id=run.id,
                model_version="stub-1",
                priority=Priority.low,
                confidence=0.9,
                created_at=NOW,
            )
        )
        await session.commit()

        rollups = await topic_priority_rollups(session)
        by_topic = {r["topic_id"]: r for r in rollups}
        topic_id = seeded["topic_ids"][11]
        # latest-only: high(0.9) + low(0.9), both fresh → 0.5 → medium
        assert by_topic[topic_id]["priority_rollup"] == "medium"
        assert len(rollups) == 1  # only topic 11's posts have results


class TestDailyAggregates:
    async def test_shape(self, session):
        await seed_corpus(session)
        # The corpus is anchored at a fixed past date (NOW) while the
        # aggregator's cutoff is relative to the real wall clock, so any
        # "N-day" window eventually empties out. This test only checks the
        # response shape and that all seeded posts are counted, so use a window
        # wide enough to always include them.
        daily = await daily_aggregates(session, days=3650)
        assert set(daily) == {"volume", "sentiment", "priority"}
        assert all({"date", "posts"} == set(v) for v in daily["volume"])
        assert sum(v["posts"] for v in daily["volume"]) == 4


class TestRunAggregation:
    async def test_orchestrates_stub_stages(self, session):
        seeded = await seed_corpus(session)
        stats = await run_aggregation(session=session)

        assert stats["stage"] == "aggregation"
        assert stats["extraction"]["mode"] == "stub"
        assert stats["priority"]["mode"] == "stub"
        assert stats["sentiment"]["mode"] == "stub"
        assert stats["priority"]["posts"] == 4
        assert stats["sentiment"]["posts"] == 4

        from app.models import Extraction, PriorityResult, SentimentResult

        n_prio = await session.scalar(select(func.count(PriorityResult.id)))
        n_sent = await session.scalar(select(func.count(SentimentResult.id)))
        n_ext = await session.scalar(select(func.count(Extraction.id)))
        assert n_prio == 4
        assert n_sent == 4
        assert n_ext > 0

        versions = set(
            (
                await session.execute(select(PriorityResult.model_version).distinct())
            ).scalars()
        )
        assert versions == {"stub-1"}

        runs = (
            (
                await session.execute(
                    select(PipelineRun).where(PipelineRun.kind == RunKind.analyze)
                )
            )
            .scalars()
            .all()
        )
        assert len(runs) == 1
        assert runs[0].status is RunStatus.done

    async def test_second_run_skips_analyzed_posts(self, session):
        await seed_corpus(session)
        await run_aggregation(session=session)
        stats = await run_aggregation(session=session)
        assert stats["priority"]["posts"] == 0
        assert stats["sentiment"]["posts"] == 0

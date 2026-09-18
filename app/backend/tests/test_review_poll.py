"""run_review_poll / poll_stage — the Review Hub read-back (app/services/aihub/review.py).

Had zero test coverage before this job kind was wired into the scheduler and
worker: nothing exercised the "a human confirmed/corrected a prediction in
the AI Hub UI" path. All AI Hub HTTP is respx-mocked; the client is swapped
for one carrying a fixed token so the test doesn't depend on env/settings.
"""

from __future__ import annotations

from datetime import datetime, timezone

import respx
from httpx import Response
from sqlalchemy import select

import app.services.aihub.review as review_module
from app.config import get_settings
from app.models import (
    PipelineRun,
    Priority,
    PriorityResult,
    ReviewFeedback,
    RunKind,
    RunStatus,
)
from app.services.aihub.client import AIHubClient
from app.services.aihub.review import poll_stage, run_review_poll
from tests.corpus import seed_corpus

TEST_TOKEN = "tok-review-test"


def _client_factory(kind: str, run_id: int | None = None) -> AIHubClient:
    """Same AIHubClient the real code uses, minus the settings-token lookup —
    stub mode always wins there since conftest scrubs every AIHUB_* env var."""
    return AIHubClient(kind, token=TEST_TOKEN, run_id=run_id, retry_wait_mult=0)


def _result_url(result_id: str) -> str:
    s = get_settings()
    path = s.aihub_classification_result_path.format(result_id=result_id)
    return f"{s.aihub_base_url}{s.aihub_api_prefix}{path}"


async def _make_run(session) -> int:
    run = PipelineRun(kind=RunKind.analyze, status=RunStatus.done)
    session.add(run)
    await session.flush()
    return run.id


class TestNoToken:
    async def test_run_review_poll_skips_without_settings_token(self, session):
        # No monkeypatch here: settings tokens are genuinely blank (conftest),
        # so both stages report skipped and nothing touches the network.
        stats = await run_review_poll(session)
        assert stats["stage"] == "review"
        assert stats["priority"]["mode"] == "skipped"
        assert stats["sentiment"]["mode"] == "skipped"

    async def test_disabled_setting_short_circuits(self, session, monkeypatch):
        monkeypatch.setattr(get_settings(), "review_poll_enabled", False)
        stats = await run_review_poll(session)
        assert stats == {"stage": "review", "mode": "disabled"}


class TestPollStage:
    async def test_no_pending_rows_is_a_clean_noop(self, session, monkeypatch):
        monkeypatch.setattr(review_module, "AIHubClient", _client_factory)
        stats = await poll_stage(session, "priority", run_id=None)
        assert stats == {"stage": "review:priority", "mode": "aihub", "checked": 0}

    @respx.mock
    async def test_confirmed_prediction_marks_reviewed_no_correction(
        self, session, monkeypatch
    ):
        monkeypatch.setattr(review_module, "AIHubClient", _client_factory)
        seeded = await seed_corpus(session)
        run_id = await _make_run(session)
        result = PriorityResult(
            post_id=seeded["post_ids"][0],
            run_id=run_id,
            model_version="v1",
            priority=Priority.high,
            confidence=0.4,
            reviewed=False,
            created_at=datetime.now(timezone.utc),
            aihub_result_id="res-confirmed",
        )
        session.add(result)
        await session.flush()

        respx.get(_result_url("res-confirmed")).mock(
            return_value=Response(
                200,
                json={
                    "_id": "res-confirmed",
                    "review_status": "Verified",
                    "output": {"category": {"name": "high", "confidence": 0.4}},
                },
            )
        )

        stats = await poll_stage(session, "priority", run_id=None)
        assert stats == {
            "stage": "review:priority",
            "mode": "aihub",
            "checked": 1,
            "verified": 1,
            "corrected": 0,
        }
        await session.refresh(result)
        assert result.reviewed is True
        assert result.priority is Priority.high  # unchanged, no correction

        feedback = (await session.execute(select(ReviewFeedback))).scalars().all()
        assert feedback == []  # confirming (no label change) writes no correction row

    @respx.mock
    async def test_corrected_prediction_updates_result_and_writes_feedback(
        self, session, monkeypatch
    ):
        monkeypatch.setattr(review_module, "AIHubClient", _client_factory)
        seeded = await seed_corpus(session)
        run_id = await _make_run(session)
        result = PriorityResult(
            post_id=seeded["post_ids"][1],
            run_id=run_id,
            model_version="v1",
            priority=Priority.high,
            confidence=0.3,
            reviewed=False,
            created_at=datetime.now(timezone.utc),
            aihub_result_id="res-corrected",
        )
        session.add(result)
        await session.flush()
        result_id = result.id

        respx.get(_result_url("res-corrected")).mock(
            return_value=Response(
                200,
                json={
                    "_id": "res-corrected",
                    "review_status": "Verified",
                    "manual_classification": "low",
                },
            )
        )

        stats = await poll_stage(session, "priority", run_id=None)
        assert stats["verified"] == 1
        assert stats["corrected"] == 1

        await session.refresh(result)
        assert result.reviewed is True
        assert result.priority is Priority.low  # corrected by the human reviewer

        feedback = (await session.execute(select(ReviewFeedback))).scalars().one()
        assert feedback.result_type == "priority"
        assert feedback.result_id == result_id
        assert feedback.original_value == "high"
        assert feedback.corrected_value == "low"
        assert feedback.reviewed_by == "aihub-review-hub"

    @respx.mock
    async def test_still_pending_leaves_result_untouched(self, session, monkeypatch):
        monkeypatch.setattr(review_module, "AIHubClient", _client_factory)
        seeded = await seed_corpus(session)
        run_id = await _make_run(session)
        result = PriorityResult(
            post_id=seeded["post_ids"][2],
            run_id=run_id,
            model_version="v1",
            priority=Priority.medium,
            confidence=0.5,
            reviewed=False,
            created_at=datetime.now(timezone.utc),
            aihub_result_id="res-pending",
        )
        session.add(result)
        await session.flush()

        respx.get(_result_url("res-pending")).mock(
            return_value=Response(200, json={"_id": "res-pending", "review_status": "Pending"})
        )

        stats = await poll_stage(session, "priority", run_id=None)
        assert stats["verified"] == 0
        await session.refresh(result)
        assert result.reviewed is False

    @respx.mock
    async def test_one_failed_lookup_does_not_fail_the_batch(self, session, monkeypatch):
        monkeypatch.setattr(review_module, "AIHubClient", _client_factory)
        seeded = await seed_corpus(session)
        run_id = await _make_run(session)
        ok = PriorityResult(
            post_id=seeded["post_ids"][0],
            run_id=run_id,
            model_version="v1",
            priority=Priority.high,
            confidence=0.4,
            reviewed=False,
            created_at=datetime.now(timezone.utc),
            aihub_result_id="res-ok",
        )
        broken = PriorityResult(
            post_id=seeded["post_ids"][1],
            run_id=run_id,
            model_version="v1",
            priority=Priority.medium,
            confidence=0.4,
            reviewed=False,
            created_at=datetime.now(timezone.utc),
            aihub_result_id="res-500",
        )
        session.add_all([ok, broken])
        await session.flush()

        respx.get(_result_url("res-ok")).mock(
            return_value=Response(200, json={"_id": "res-ok", "review_status": "Verified"})
        )
        respx.get(_result_url("res-500")).mock(return_value=Response(500, json={}))

        stats = await poll_stage(session, "priority", run_id=None)
        assert stats["checked"] == 2
        assert stats["verified"] == 1  # the 500 is isolated, not fatal to the run

        await session.refresh(ok)
        await session.refresh(broken)
        assert ok.reviewed is True
        assert broken.reviewed is False

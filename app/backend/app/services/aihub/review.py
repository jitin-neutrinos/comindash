"""Review Hub read-back — the human-in-the-loop half of the accuracy loop.

What the docs actually allow (ai-hub/review-hub-text-model, ai-hub/retrain-model,
the SDK usage guides):

* **Routing** a prediction into the Review Hub is a model-side rule set in the
  AI Hub UI (Feedback Loop: Always / below confidence threshold / Never). There
  is no API to configure it, so the plan's "wire confidence-threshold routing to
  Review Hub" is a one-time UI setting, not backend code.
* **Reviewing** happens in the AI Hub UI (Confirm / Skip / Ignore).
* **Retraining** is a UI action (Prediction/Extraction -> Versions -> Retrain),
  seeded from Review-Hub-approved data. There is no retrain API, so the plan's
  "weekly retrain job" cannot be automated — this module instead keeps the
  dashboard honest about how much of the data a human has verified.

So what *is* automatable, and what this module does:

1. Poll the AI Hub result ids we stored (``aihub_result_id``) for results whose
   ``review_status`` has moved off "Pending".
2. Mark the local row ``reviewed`` and, when the human changed the label, write
   a ``review_feedback`` row and correct the local result.

``send_correction`` is the reverse direction (``sendFeedback``), for corrections
that originate on our side rather than in the Review Hub UI.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    PipelineRun,
    Priority,
    PriorityResult,
    ReviewFeedback,
    RunKind,
    RunStatus,
    Sentiment,
    SentimentResult,
)
from app.services.aihub.client import AIHubClient
from app.services.aihub.priority import LABEL_MAP as PRIORITY_LABELS
from app.services.aihub.sentiment import LABEL_MAP as SENTIMENT_LABELS
from app.services.database_session import get_run_session

logger = logging.getLogger("aihub.review")

PENDING_STATUSES = {"", "pending"}

STAGES = {
    "priority": (PriorityResult, "priority", PRIORITY_LABELS),
    "sentiment": (SentimentResult, "sentiment", SENTIMENT_LABELS),
}


def reviewed_value(payload: dict) -> tuple[bool, str | None]:
    """(is_reviewed, corrected_label) from an AI Hub result document."""
    status = str(payload.get("review_status") or "").strip().lower()
    if status in PENDING_STATUSES:
        return False, None
    corrected = (
        payload.get("manual_classification")
        or payload.get("manual_category")
        or (payload.get("output") or {}).get("manual_category")
    )
    return True, (str(corrected).strip().lower() if corrected else None)


async def poll_stage(session: AsyncSession, stage: str, run_id: int | None) -> dict:
    model, field, labels = STAGES[stage]
    client = AIHubClient(stage, run_id=run_id)
    if not client.is_configured:
        return {"stage": f"review:{stage}", "mode": "skipped"}

    limit = get_settings().review_poll_batch
    rows = (
        (
            await session.execute(
                select(model)
                .where(model.aihub_result_id.is_not(None), model.reviewed.is_(False))
                .order_by(model.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return {"stage": f"review:{stage}", "mode": "aihub", "checked": 0}

    payloads = await asyncio.gather(
        *(client.get_result(r.aihub_result_id) for r in rows),
        return_exceptions=True,
    )

    verified = 0
    corrected = 0
    now = datetime.now(timezone.utc)
    for row, payload in zip(rows, payloads):
        if isinstance(payload, BaseException):
            logger.warning(
                "review poll failed for %s result %s: %s",
                stage,
                row.aihub_result_id,
                payload,
            )
            continue
        is_reviewed, new_label = reviewed_value(payload)
        if not is_reviewed:
            continue
        row.reviewed = True
        verified += 1
        if new_label is None:
            continue
        new_value = labels.get(new_label)
        original = getattr(row, field)
        if new_value is None or new_value == original:
            continue
        setattr(row, field, new_value)
        session.add(
            ReviewFeedback(
                result_type=stage,
                result_id=row.id,
                original_value=original.value,
                corrected_value=new_value.value,
                reviewed_by="aihub-review-hub",
                reviewed_at=now,
            )
        )
        corrected += 1

    await session.flush()
    return {
        "stage": f"review:{stage}",
        "mode": "aihub",
        "checked": len(rows),
        "verified": verified,
        "corrected": corrected,
    }


async def send_correction(
    stage: str, result_id: str, corrected_value: str, reason: str = ""
) -> dict:
    """Push a correction we made locally back to AI Hub (``sendFeedback``)."""
    client = AIHubClient(stage)
    return await client.send_feedback(result_id, corrected_value, reason)


async def run_review_poll(
    session: AsyncSession | None = None, run_id: int | None = None
) -> dict:
    """Pull Review Hub verdicts for both classifiers. Safe with no tokens."""
    if session is None:
        async with get_run_session() as s:
            return await run_review_poll(s, run_id=run_id)

    if not get_settings().review_poll_enabled:
        return {"stage": "review", "mode": "disabled"}

    own_run = run_id is None
    if own_run:
        run = PipelineRun(
            kind=RunKind.analyze,
            status=RunStatus.running,
            started_at=datetime.now(timezone.utc),
            triggered_by="review_poll",
        )
        session.add(run)
        await session.flush()
        run_id = run.id

    stats: dict = {"stage": "review"}
    for stage in STAGES:
        stats[stage] = await poll_stage(session, stage, run_id)

    if own_run:
        run = await session.get(PipelineRun, run_id)
        run.status = RunStatus.done
        run.finished_at = datetime.now(timezone.utc)
        run.stats = stats
    await session.commit()
    return stats

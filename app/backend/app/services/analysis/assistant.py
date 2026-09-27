"""Analyst assistant cycle.

No local/stub equivalent exists for a chat assistant, so this stage always
records ``mode: skipped`` — same behaviour as when AI Hub's assistant token
was unset. ``parse_assistant_reply`` and ``build_analysis_extract`` stay
because they have no AI Hub coupling (pure JSON parsing / DB query building)
and pipeline-v3 will reuse both against whatever model answers instead.

# TODO(pipeline-v3): replace skip mode with a local model / GLM assistant call
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Extraction,
    PipelineRun,
    Post,
    Priority,
    PriorityResult,
    RunKind,
    RunStatus,
    Sentiment,
    SentimentResult,
    Topic,
)
from app.services.database_session import get_run_session

logger = logging.getLogger("analysis.assistant")

MAX_EXTRACT_POSTS = 120
MAX_EXTRACT_ENTITIES = 40


def parse_assistant_reply(content: str) -> list[dict]:
    """Extract the JSON insights array from an assistant reply.

    The assistant is instructed to answer with a JSON object matching the
    ingest payload contract; we tolerate fenced code blocks and prose around it.
    """
    if not content:
        return []
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        logger.warning("assistant reply was not valid JSON")
        return []
    if isinstance(data, dict):
        insights = data.get("insights", [])
    else:
        insights = data
    return insights if isinstance(insights, list) else []


ANALYST_PROMPT = (
    "You are the community analyst for the Neutrinos Discourse forum. Below is "
    "the current analysis extract: recent posts with their priority, sentiment "
    "and extracted entities, plus aggregate counts. Identify pain points, "
    "trends, anomalies and relationships between components. Answer with ONLY "
    'a JSON object: {"insights": [{"insight_type": "pain_point|trend|'
    'anomaly|relationship|recommendation", "title": "...", "body": "...", '
    '"severity": "high|medium|low", "evidence": [{"discourse_post_id": 0, '
    '"quote": "...", "relevance_note": "..."}], "relationships": '
    '[{"subject_type": "entity", "subject_value": "...", "relation": '
    '"correlates_with", "object_type": "topic", "object_value": "...", '
    '"strength": 0.0}]}]}. Every insight needs at least one evidence '
    "discourse_post_id taken from the extract below — insights whose evidence "
    "ids are not in the extract are rejected.\n\n=== ANALYSIS EXTRACT ===\n"
)


async def build_analysis_extract(session: AsyncSession) -> str:
    """The rolling dataset the Analyst would reason over, rendered for the message."""
    totals = {
        "posts": await session.scalar(select(func.count(Post.id))) or 0,
        "topics": await session.scalar(select(func.count(Topic.id))) or 0,
    }
    prio_rows = await session.execute(
        select(PriorityResult.priority, func.count()).group_by(PriorityResult.priority)
    )
    sent_rows = await session.execute(
        select(SentimentResult.sentiment, func.count()).group_by(
            SentimentResult.sentiment
        )
    )
    totals["priority"] = {p.value: n for p, n in prio_rows}
    totals["sentiment"] = {s.value: n for s, n in sent_rows}

    entity_rows = await session.execute(
        select(Extraction.entity_text, Extraction.entity_label, func.count())
        .group_by(Extraction.entity_text, Extraction.entity_label)
        .order_by(func.count().desc())
        .limit(MAX_EXTRACT_ENTITIES)
    )
    top_entities = [
        {"entity": t, "label": lbl, "mentions": n} for t, lbl, n in entity_rows
    ]

    # Highest-signal posts first: high priority, then negative sentiment.
    post_rows = await session.execute(
        select(
            Post.discourse_post_id,
            Post.body_text,
            Topic.title,
            Topic.category,
            PriorityResult.priority,
            PriorityResult.confidence,
            SentimentResult.sentiment,
        )
        .join(Topic, Topic.id == Post.topic_id, isouter=True)
        .join(PriorityResult, PriorityResult.post_id == Post.id, isouter=True)
        .join(SentimentResult, SentimentResult.post_id == Post.id, isouter=True)
        .order_by(
            (PriorityResult.priority == Priority.high).desc(),
            (SentimentResult.sentiment == Sentiment.neg).desc(),
            Post.created_at.desc().nullslast(),
        )
        .limit(MAX_EXTRACT_POSTS)
    )
    posts = [
        {
            "discourse_post_id": dpid,
            "topic": title or "",
            "category": category or "",
            "priority": priority.value if priority else None,
            "priority_confidence": round(confidence, 3) if confidence else None,
            "sentiment": sentiment.value if sentiment else None,
            "text": (body or "")[:600],
        }
        for dpid, body, title, category, priority, confidence, sentiment in post_rows
    ]

    return json.dumps(
        {"totals": totals, "top_entities": top_entities, "posts": posts},
        ensure_ascii=False,
    )


async def build_request_extract(session: AsyncSession) -> str:
    """The extract sized for the GLM request: 60 posts x 280 chars (~32KB).

    The full extract (~93KB at 120x600) makes glm-4.5-flash spend its whole
    completion budget on reasoning; the shrunk one returns clean JSON.
    """
    full = await build_analysis_extract(session)
    data = json.loads(full)
    data["posts"] = [{**p, "text": p["text"][:280]} for p in data["posts"][:60]]
    return json.dumps(data, ensure_ascii=False)


async def run_assistant_cycle(
    session: AsyncSession | None = None,
    run_id: int | None = None,
    forum_id: int | None = None,
) -> dict:
    """Nightly analyst cycle: build extract -> GLM -> insights_gate.

    GLM unavailable / fails -> skip mode (stats explain why), never crashes
    the worker. When GLM answers, insights go through the SAME evidence gate
    as the external ingest API — invalid evidence is rejected per-item.
    """
    if session is None:
        async with get_run_session() as s:
            return await run_assistant_cycle(s, run_id=run_id, forum_id=forum_id)

    own_run = run_id is None
    if own_run:
        run = PipelineRun(
            kind=RunKind.assistant,
            status=RunStatus.running,
            started_at=datetime.now(timezone.utc),
            triggered_by="assistant_cycle",
        )
        session.add(run)
        await session.flush()
        run_id = run.id

    # --- GLM analysis -------------------------------------------------------
    from app.services import insights_gate
    from app.services.analysis import glm_client

    stats: dict
    try:
        extract = await build_request_extract(session)
        payload = await glm_client.request_insights(extract)
    except Exception as exc:  # noqa: BLE001 — degrade, don't crash the worker
        stats = {
            "stage": "assistant_cycle",
            "mode": "skipped",
            "reason": f"GLM unavailable: {type(exc).__name__}: {str(exc)[:250]}",
        }
        logger.info("assistant cycle skipped: %s", stats["reason"])
    else:
        parsed = insights_gate.parse_payload(payload)
        if parsed is None:
            stats = {
                "stage": "assistant_cycle",
                "mode": "rejected",
                "reason": "GLM payload failed schema validation",
            }
        else:
            gate = await insights_gate.ingest_insights(session, parsed, run_id=run_id)
            stats = {
                "stage": "assistant_cycle",
                "mode": "glm",
                "assistant_version": glm_client.ASSISTANT_VERSION,
                "insights_accepted": gate.accepted,
                "insights_rejected": gate.rejected,
                "insight_ids": gate.insight_ids,
            }
            if gate.errors:
                stats["errors"] = [e.model_dump() for e in gate.errors][:10]

    if own_run:
        run = await session.get(PipelineRun, run_id)
        run.status = RunStatus.done
        run.finished_at = datetime.now(timezone.utc)
        run.stats = stats
        run.triggered_by = f"assistant_cycle:{stats.get('mode', 'unknown')}"
    await session.commit()
    return stats

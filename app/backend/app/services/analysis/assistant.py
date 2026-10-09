"""Analyst assistant cycle (pipeline-v3, full-corpus map-reduce).

Each cycle: rank the whole non-empty corpus, chunk it (POSTS_PER_CHUNK posts
per chunk), one GLM extractor call per chunk, then ONE synthesis call merging
candidate findings into a single insight set. The gate inserts that set in
supersede="all" mode: a successful run atomically replaces the entire
previous active set (rollback leaves the old set untouched on any failure).
Token usage from every GLM response is summed into the ``insight_runs``
ledger row, including on failed/skipped runs (spend survives the rollback).
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

MAX_EXTRACT_ENTITIES = 40
MAX_EXTRACT_POSTS = 500  # synthesis header cap (totals + top entities feed the merge call)

POSTS_PER_CHUNK = 200
POST_TEXT_CHARS = 280
MAX_CANDIDATES_PER_CHUNK = 8
MAX_INSIGHTS = 40


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
    """The rolling dataset aggregates for synthesis."""
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





import time
import os
from datetime import timezone

async def run_assistant_cycle(
    session: AsyncSession | None = None,
    run_id: int | None = None,
    forum_id: int | None = None,
    triggered_by: str = "assistant_cycle",
) -> dict:
    if session is None:
        async with get_run_session() as s:
            return await run_assistant_cycle(s, run_id=run_id, forum_id=forum_id, triggered_by=triggered_by)

    from app.services import insights_gate
    from app.services.analysis import glm_client
    from app.services.analysis import corpus_chunks
    from app.models import InsightRun, InsightRunStatus, PipelineRun

    own_run = run_id is None
    if own_run:
        run = PipelineRun(
            kind=RunKind.assistant,
            status=RunStatus.running,
            started_at=datetime.now(timezone.utc),
            triggered_by=triggered_by,
        )
        session.add(run)
        await session.flush()
        run_id = run.id

    insight_run = InsightRun(
        run_id=run_id,
        triggered_by=triggered_by,
        model=os.environ.get("GLM_MODEL", "glm-4.5-flash"),
        status=InsightRunStatus.running
    )
    session.add(insight_run)
    await session.flush()
    insight_run_id = insight_run.id

    stats: dict = {}
    exc_caught = None
    skipped = False
    msg = None
    t0 = time.time()
    try:
        rows = await corpus_chunks.fetch_ranked_posts(session)
        insight_run.posts_covered = len(rows)
        topics = set()
        for r in rows:
            if r.Topic:
                topics.add(r.Topic.id)
        insight_run.topics_covered = len(topics)

        chunks = corpus_chunks.make_chunks(rows, POSTS_PER_CHUNK)
        insight_run.chunk_calls = len(chunks)

        candidates = []
        for c in chunks:
            chunk_json = corpus_chunks.render_chunk(c)
            res = await glm_client.request_chunk_findings(chunk_json)
            insight_run.prompt_tokens += res.prompt_tokens
            insight_run.completion_tokens += res.completion_tokens
            insight_run.total_tokens += res.total_tokens
            
            chunk_insights = res.payload.get("insights", [])[:MAX_CANDIDATES_PER_CHUNK]
            for ins in chunk_insights:
                ev_ids = [e.get("discourse_post_id") for e in ins.get("evidence", []) if "discourse_post_id" in e]
                candidates.append({
                    "type": ins.get("insight_type", ""),
                    "title": ins.get("title", ""),
                    "severity": ins.get("severity", ""),
                    "summary": ins.get("body", ""),
                    "evidence_post_ids": ev_ids
                })

        totals_json = await build_analysis_extract(session)
        totals_dict = json.loads(totals_json)
        
        synthesis_input = {
            "totals": totals_dict.get("totals", {}),
            "candidates": candidates
        }
        
        synth_res = await glm_client.request_synthesis(json.dumps(synthesis_input, ensure_ascii=False))
        insight_run.prompt_tokens += synth_res.prompt_tokens
        insight_run.completion_tokens += synth_res.completion_tokens
        insight_run.total_tokens += synth_res.total_tokens
        
        final_insights = synth_res.payload.get("insights", [])[:MAX_INSIGHTS]
        
        parsed = insights_gate.parse_payload(
            {
                "insights": final_insights,
                "assistant_version": glm_client.ASSISTANT_VERSION,
                "run_ref": triggered_by,
            }
        )
        if parsed is None:
            insight_run.status = InsightRunStatus.failed
            insight_run.error = "GLM payload failed schema validation"
            stats = {"mode": "rejected", "reason": "validation"}
        else:
            insight_run.insights_generated = len(final_insights)
            gate = await insights_gate.ingest_insights(session, parsed, run_id=run_id, supersede="all")
            
            insight_run.status = InsightRunStatus.succeeded
            if gate.accepted == 0 and len(final_insights) > 0:
                insight_run.status = InsightRunStatus.failed
                insight_run.error = "Gate rejected all insights"

            insight_run.insights_accepted = gate.accepted
            insight_run.insights_rejected = gate.rejected
            if gate.errors:
                err_str = "; ".join([str(e.model_dump()) for e in gate.errors])
                insight_run.error = err_str[:1000]

            stats = {
                "stage": "assistant_cycle",
                "mode": "glm",
                "assistant_version": glm_client.ASSISTANT_VERSION,
                "insights_accepted": gate.accepted,
                "insights_rejected": gate.rejected,
                "insight_ids": gate.insight_ids,
            }
        
        insight_run.cost_usd = glm_client.estimate_cost_usd(insight_run.total_tokens)
        insight_run.duration_ms = int((time.time() - t0) * 1000)

    except Exception as exc:
        exc_caught = exc

    if exc_caught:
        # Real spend already made must survive the rollback that unwinds the
        # failed run — snapshot counters, restore them onto the fresh row.
        spent_prompt = insight_run.prompt_tokens
        spent_completion = insight_run.completion_tokens
        spent_total = insight_run.total_tokens
        spent_posts = insight_run.posts_covered
        spent_topics = insight_run.topics_covered
        spent_chunks = insight_run.chunk_calls

        await session.rollback()

        # Need to re-create the records because of the rollback
        if own_run:
            run = PipelineRun(
                kind=RunKind.assistant,
                status=RunStatus.running,
                started_at=datetime.now(timezone.utc),
                triggered_by=triggered_by,
            )
            session.add(run)
            await session.flush()
            run_id = run.id

        insight_run = InsightRun(
            run_id=run_id,
            triggered_by=triggered_by,
            model=os.environ.get("GLM_MODEL", "glm-4.5-flash"),
        )
        session.add(insight_run)

        # GLM unavailable (missing key / unreachable / rate-blocked) is the
        # designed skip: nothing changed, next window retries. Any other
        # exception is a genuine failure.
        msg = f"{type(exc_caught).__name__}: {str(exc_caught)[:250]}"
        skipped = isinstance(exc_caught, glm_client.GLMError)
        insight_run.status = (
            InsightRunStatus.skipped if skipped else InsightRunStatus.failed
        )
        insight_run.error = msg
        insight_run.posts_covered = spent_posts
        insight_run.topics_covered = spent_topics
        insight_run.chunk_calls = spent_chunks
        insight_run.prompt_tokens = spent_prompt
        insight_run.completion_tokens = spent_completion
        insight_run.total_tokens = spent_total
        insight_run.cost_usd = glm_client.estimate_cost_usd(spent_total)
        insight_run.duration_ms = int((time.time() - t0) * 1000)
        stats = {
            "stage": "assistant_cycle",
            "mode": "skipped" if skipped else "failed",
            "reason": msg,
        }
        logger.info("assistant cycle skipped/failed: %s", stats["reason"])

    if own_run:
        run = await session.get(PipelineRun, run_id)
        if run:
            # A genuinely failed insight run must NOT be recorded as a done
            # pipeline run — /api/health, the StaleBanner and the scheduler
            # freshness gate all read this status (2026-10-09: a JSONDecode-
            # Error failure showed as "done" and masked the outage). A skip
            # (quota/429, nothing changed) legitimately stays "done".
            run.status = (
                RunStatus.done if skipped else RunStatus.failed
            ) if exc_caught else RunStatus.done
            run.error = msg if (exc_caught and not skipped) else None
            run.finished_at = datetime.now(timezone.utc)
            run.stats = stats
            run.triggered_by = f"{triggered_by}:{stats.get('mode', 'unknown')}"

    await session.commit()
    return stats

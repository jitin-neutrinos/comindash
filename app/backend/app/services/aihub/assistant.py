"""Analyst assistant integration.

Verified against ai-hub/integrate-api-assistant (Sync APIs):

    POST {base}/inferenceservice/assistant/conversation/create
         {"metadata": {...}, "translation_enabled": false}     -> {"_id": ...}
    POST {base}/inferenceservice/assistant/message/create
         {"conversation_id": "...", "text": "...", "sources": [ids],
          "metadata": {...}}                       -> {"output": {"text": "..."}}
    POST {base}/inferenceservice/assistant/knowledge/find-all
         {"page_number": 0, "page_size": 50, "sort": {...}}
                                        -> {"data": [{"_id", "name"}], "total"}

Two corrections to the v2 plan, both forced by the documented API surface:

* There is **no assistant id in any request body** — the token identifies the
  assistant, version and deployment (ai-hub/tokens).
* Knowledge sources are **read-only over the API** (ai-hub/knowledgeservice:
  "Supports: Listing knowledge sources with pagination and sorting"). They
  cannot be created or refreshed programmatically, so the plan's
  "auto-refreshed analysis extract per cycle" knowledge-source pipeline is not
  buildable. Instead the cycle sends the current analysis extract inline in the
  message ``text``; mapped knowledge sources stay for static reference material
  and are auto-discovered when AIHUB_KNOWLEDGE_SOURCE_IDS is unset.

No token => SKIP mode: the cycle is logged and the run records ``mode: skipped``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
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
from app.services.aihub.insights_gate import ingest_insights, parse_payload
from app.services.database_session import get_run_session

logger = logging.getLogger("aihub.assistant")

MAX_EXTRACT_POSTS = 120
MAX_EXTRACT_ENTITIES = 40


class AIHubAssistant:
    def __init__(self, run_id: int | None = None):
        s = get_settings()
        self.token = s.aihub_assistant_token
        self.assistant_id = s.aihub_assistant_id  # label only; never sent
        self.base_url = s.aihub_base_url.rstrip("/") + s.aihub_api_prefix
        self.timeout = s.aihub_timeout_ms / 1000
        self.run_id = run_id
        self._settings = s

    @property
    def is_configured(self) -> bool:
        return bool(self.token)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    async def _post(self, path: str, body: dict, attempts: int = 3) -> dict:
        """POST with backoff on 5xx/timeout and a real wait on 429."""
        url = f"{self.base_url}{path}"
        last: Exception | None = None
        for attempt in range(attempts):
            try:
                logger.info(
                    "aihub assistant request run_id=%s path=%s attempt=%d",
                    self.run_id,
                    path,
                    attempt + 1,
                )
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(url, headers=self._headers(), json=body)
                if resp.status_code == 429:
                    retry_after = min(
                        float(resp.headers.get("Retry-After", "5")), 60.0
                    )
                    logger.warning(
                        "aihub assistant rate limited — waiting %.1fs", retry_after
                    )
                    await asyncio.sleep(retry_after)
                    continue
                if resp.status_code >= 500:
                    raise RuntimeError(
                        f"AI Hub assistant {resp.status_code} on {path}: "
                        f"{resp.text[:200]}"
                    )
                if resp.status_code >= 400:
                    # 4xx is our bug (bad token, bad body) — retrying will not help
                    raise RuntimeError(
                        f"AI Hub assistant {resp.status_code} on {path}: "
                        f"{resp.text[:200]}"
                    )
                return resp.json()
            except (httpx.HTTPError, RuntimeError) as e:
                last = e
                if isinstance(e, RuntimeError) and " 4" in str(e)[:40]:
                    raise
                if attempt == attempts - 1:
                    raise
                await asyncio.sleep(2**attempt)
        raise last or RuntimeError("AI Hub assistant request failed")

    async def knowledge_source_ids(self) -> list[str]:
        """Configured ids, else every source mapped to this assistant."""
        configured = self._settings.knowledge_source_ids
        if configured:
            return configured
        try:
            data = await self._post(
                self._settings.aihub_knowledge_find_all_path,
                {"page_number": 0, "page_size": 50, "sort": {"updated_at": -1}},
            )
        except Exception as e:  # noqa: BLE001 — knowledge sources are optional
            logger.warning("could not list knowledge sources: %s", e)
            return []
        return [
            str(item["_id"])
            for item in (data.get("data") or [])
            if isinstance(item, dict) and item.get("_id")
        ]

    async def create_conversation(self) -> str:
        data = await self._post(
            self._settings.aihub_conversation_create_path,
            {"metadata": {"source": "community-insights"}, "translation_enabled": False},
        )
        conv_id = data.get("_id") or data.get("id") or data.get("conversationId")
        if not conv_id:
            raise RuntimeError(
                f"AI Hub assistant conversation create returned no _id: {data}"
            )
        return str(conv_id)

    async def send_message(
        self, conversation_id: str, text: str, sources: list[str]
    ) -> str:
        body: dict = {"conversation_id": conversation_id, "text": text}
        if sources:
            body["sources"] = sources
        data = await self._post(self._settings.aihub_message_create_path, body)
        output = data.get("output")
        if isinstance(output, dict):
            return str(output.get("text") or "")
        return str(data.get("text") or "")

    async def request_insights(self, prompt: str) -> list[dict]:
        sources = await self.knowledge_source_ids()
        conversation_id = await self.create_conversation()
        reply = await self.send_message(conversation_id, prompt, sources)
        return parse_assistant_reply(reply)


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
    "the current analysis extract: recent posts with their AI Hub priority, "
    "sentiment and extracted entities, plus aggregate counts. Identify pain "
    "points, trends, anomalies and relationships between components. Answer "
    'with ONLY a JSON object: {"insights": [{"insight_type": "pain_point|trend|'
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
    """The rolling dataset the Analyst reasons over, rendered for the message.

    Knowledge sources cannot be refreshed over the API, so this goes inline in
    the message text rather than into a knowledge source.
    """
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


async def run_assistant_cycle(
    session: AsyncSession | None = None,
    run_id: int | None = None,
    forum_id: int | None = None,
) -> dict:
    """Nightly analyst cycle. SKIP mode when the token is unset.

    Raises on a real AI Hub failure so the worker fails the job and the queue's
    retry/backoff actually engages — a caught-and-returned error used to mark
    the job ``done`` and lose the night's insights until the next cycle.
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

    assistant = AIHubAssistant(run_id=run_id)
    if not assistant.is_configured:
        stats = {
            "stage": "assistant_cycle",
            "mode": "skipped",
            "reason": "AIHUB_ASSISTANT_TOKEN not set — running in stub/skip mode",
        }
        logger.info("assistant cycle skipped: no AIHUB_ASSISTANT_TOKEN")
        if own_run:
            run = await session.get(PipelineRun, run_id)
            run.status = RunStatus.done
            run.finished_at = datetime.now(timezone.utc)
            run.stats = stats
            run.triggered_by = "assistant_cycle:skipped"
        await session.commit()
        return stats

    try:
        extract = await build_analysis_extract(session)
        insights_raw = await assistant.request_insights(ANALYST_PROMPT + extract)
    except Exception as e:  # noqa: BLE001 — recorded, then re-raised for retry
        stats = {"stage": "assistant_cycle", "mode": "aihub", "error": str(e)[:500]}
        if own_run:
            run = await session.get(PipelineRun, run_id)
            run.status = RunStatus.failed
            run.finished_at = datetime.now(timezone.utc)
            run.error = str(e)[:2000]
            run.stats = stats
            await session.commit()
        logger.exception("assistant cycle failed")
        raise

    version = f"assistant-{get_settings().aihub_assistant_id or 'default'}"
    payload = {
        "assistant_version": version,
        "run_ref": f"cycle-{run_id}",
        "insights": insights_raw,
    }
    parsed = parse_payload(payload)
    if parsed is None:
        stats = {
            "stage": "assistant_cycle",
            "mode": "aihub",
            "raw_insights": len(insights_raw),
            "accepted": 0,
            "rejected": len(insights_raw),
            "error": "assistant reply failed schema validation",
        }
        if own_run:
            run = await session.get(PipelineRun, run_id)
            run.status = RunStatus.failed
            run.finished_at = datetime.now(timezone.utc)
            run.error = stats["error"]
            run.stats = stats
        await session.commit()
        return stats

    result = await ingest_insights(session, parsed, run_id=run_id)
    stats = {
        "stage": "assistant_cycle",
        "mode": "aihub",
        "raw_insights": len(insights_raw),
        "accepted": result.accepted,
        "rejected": len(result.errors),
        "insight_ids": result.insight_ids,
    }
    if own_run:
        run = await session.get(PipelineRun, run_id)
        run.status = RunStatus.done
        run.finished_at = datetime.now(timezone.utc)
        run.stats = stats
        run.triggered_by = "assistant_cycle:aihub"
    await session.commit()
    return stats

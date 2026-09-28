"""AI briefs for a node or an edge of the relationship graph.

Clicking a node/edge asks a question the nightly analyst never answers: "what
is going on *between these two specific things*?" That needs the posts where
they actually co-occur, so the brief is generated on demand and cached rather
than precomputed for every pair (an N^2 nightly job for something a user looks
at a handful of).

Grounding rules, in order:
  * the evidence is real post text pulled from the DB for exactly this pair,
  * the product blurbs come from PRODUCT_GLOSSARY (same source the nightly
    analyst is grounded in) so the two never contradict each other,
  * any nightly insight that already names this pair is handed to the model as
    prior context and cited back,
  * GLM unreachable => a deterministic evidence-only brief, clearly marked
    ``mode: "evidence"`` — never a fabricated narrative.

Cache: ``app_config`` rows keyed ``relbrief:<version>:<selection-key>``, so a
re-scored corpus or a prompt change invalidates by version bump, with no
migration.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppConfig, AssistantInsight, InsightRelationship
from app.services.analysis.glm_client import (
    GLM_BASE_URL,
    PRODUCT_GLOSSARY,
    GLMError,
    _extract_json,
)
from app.services.relationship_graph import PRODUCT_NAMES, sample_posts

logger = logging.getLogger("relationship_brief")

BRIEF_VERSION = "brief-v1"
CACHE_TTL_HOURS = 24 * 7

SYSTEM_PROMPT = (
    "You are the community analyst for the Neutrinos Discourse forum — a real "
    "enterprise low-code platform. You are given ONE relationship from the "
    "community knowledge graph plus the forum posts that produced it.\n\n"
    "Write a short, concrete briefing for an engineering leader. Ground every "
    "claim in the supplied posts and product descriptions; never invent a "
    "product capability, a person's role, or a number that is not given.\n\n"
    "Answer with ONLY a JSON object:\n"
    '{"summary": str (2-3 sentences, what this relationship IS and why it '
    'exists), "why_it_matters": str (1-2 sentences, the operational '
    'consequence), "signals": [str] (2-4 short bullet observations drawn from '
    'the posts, each naming a concrete detail), "watch_out": str (1 sentence: '
    'the risk, or "" if the evidence does not support one), "confidence": '
    '"high|medium|low"}\n'
    "Set confidence low when the evidence is thin (one or two posts) or the "
    "posts do not clearly explain the link. Do not pad. No markdown."
)


def _key_label(key: str, labels: dict[str, str]) -> str:
    if key in labels:
        return labels[key]
    kind, _, value = key.partition(":")
    if kind == "product":
        return PRODUCT_NAMES.get(value, value.replace("_", " ").title())
    return value


def _describe(key: str) -> str:
    kind, _, value = key.partition(":")
    if kind == "product":
        return PRODUCT_GLOSSARY.get(value, "")
    if kind == "person":
        return "A community member (forum participant)."
    return ""


def cache_key(keys: list[str]) -> str:
    raw = "|".join(sorted(keys))
    digest = hashlib.sha256(raw.encode()).hexdigest()[:24]
    return f"relbrief:{BRIEF_VERSION}:{digest}"


def build_prompt(
    keys: list[str],
    labels: dict[str, str],
    posts: list[dict],
    stats: dict,
    prior_insights: list[dict],
) -> str:
    parties = [
        {
            "name": _key_label(k, labels),
            "kind": k.partition(":")[0],
            "what_it_is": _describe(k),
        }
        for k in keys
    ]
    payload = {
        "relationship": {
            "parties": parties,
            "type": "pair" if len(keys) > 1 else "single_entity",
        },
        "graph_stats": stats,
        "prior_analyst_insights": prior_insights,
        "evidence_posts": [
            {
                "topic": p["topic"],
                "excerpt": p["excerpt"],
                "discourse_post_id": p["discourse_post_id"],
            }
            for p in posts
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def fallback_brief(
    keys: list[str], labels: dict[str, str], posts: list[dict], stats: dict
) -> dict:
    """Deterministic, evidence-only brief. Stated as such — never dressed up."""
    names = [_key_label(k, labels) for k in keys]
    joined = " and ".join(names)
    co = stats.get("co_mention_posts")
    if len(keys) > 1 and co:
        summary = (
            f"{joined} appear together in {co} community "
            f"{'post' if co == 1 else 'posts'}. The AI narrative is "
            "unavailable right now, so this is the raw evidence only."
        )
    else:
        summary = (
            f"{joined} appears in {stats.get('mentions', 0)} community posts. "
            "The AI narrative is unavailable right now, so this is the raw "
            "evidence only."
        )
    return {
        "summary": summary,
        "why_it_matters": "",
        "signals": [p["topic"] for p in posts[:4] if p.get("topic")],
        "watch_out": "",
        "confidence": "low",
        "mode": "evidence",
    }


async def _call_glm(extract: str) -> dict:
    api_key = os.environ.get("GLM_API_KEY", "")
    if not api_key:
        raise GLMError("GLM_API_KEY not set")
    model = os.environ.get("GLM_MODEL", "glm-4.5-flash")
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            GLM_BASE_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "thinking": {"type": "disabled"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "=== RELATIONSHIP ===\n" + extract},
                ],
                "max_tokens": 1200,
                "temperature": 0.3,
            },
        )
    if resp.status_code == 429:
        raise GLMError(f"GLM 429: {resp.text[:200]}")
    resp.raise_for_status()
    content = (
        (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
    )
    if not content:
        raise GLMError("empty GLM reply")
    return _extract_json(content)


def _coerce(payload: dict) -> dict:
    signals = payload.get("signals") or []
    if isinstance(signals, str):
        signals = [signals]
    conf = str(payload.get("confidence", "medium")).lower()
    return {
        "summary": str(payload.get("summary", "")).strip(),
        "why_it_matters": str(payload.get("why_it_matters", "")).strip(),
        "signals": [str(s).strip() for s in signals if str(s).strip()][:5],
        "watch_out": str(payload.get("watch_out", "")).strip(),
        "confidence": conf if conf in {"high", "medium", "low"} else "medium",
        "mode": "glm",
    }


async def _prior_insights(session: AsyncSession, labels: dict[str, str]) -> list[dict]:
    """Nightly analyst insights whose relationship endpoints name these parties."""
    wanted = {v.casefold() for v in labels.values() if v}
    if not wanted:
        return []
    rows = (
        await session.execute(
            select(
                InsightRelationship.subject_value,
                InsightRelationship.relation,
                InsightRelationship.object_value,
                AssistantInsight.title,
                AssistantInsight.body,
            )
            .join(
                AssistantInsight,
                AssistantInsight.id == InsightRelationship.insight_id,
            )
            .order_by(InsightRelationship.strength.desc())
            .limit(80)
        )
    ).all()
    out: list[dict] = []
    for subj, rel, obj, title, body in rows:
        text = f"{subj} {obj}".casefold()
        if any(w in text for w in wanted):
            out.append(
                {
                    "assertion": f"{subj} {rel} {obj}",
                    "insight_title": title,
                    "insight_body": (body or "")[:400],
                }
            )
        if len(out) >= 4:
            break
    return out


async def get_brief(
    session: AsyncSession,
    keys: list[str],
    labels: dict[str, str],
    stats: dict,
    refresh: bool = False,
) -> dict:
    ckey = cache_key(keys)
    now = datetime.now(timezone.utc)

    if not refresh:
        row = await session.get(AppConfig, ckey)
        if row is not None:
            age_h = (now - row.updated_at).total_seconds() / 3600 if row.updated_at else 1e9
            if age_h < CACHE_TTL_HOURS:
                cached = dict(row.value or {})
                cached["cached"] = True
                return cached

    posts = await sample_posts(session, keys, limit=8)
    prior = await _prior_insights(session, labels)
    stats = {**stats, "evidence_posts_found": len(posts)}

    if not posts and not prior:
        brief = fallback_brief(keys, labels, posts, stats)
        brief["reason"] = "no evidence posts found for this selection"
    else:
        try:
            payload = await _call_glm(build_prompt(keys, labels, posts, stats, prior))
            brief = _coerce(payload)
        except Exception as exc:  # noqa: BLE001 — degrade, never 500 the page
            logger.info("relationship brief fell back: %s: %s", type(exc).__name__, exc)
            brief = fallback_brief(keys, labels, posts, stats)
            brief["reason"] = f"{type(exc).__name__}: {str(exc)[:200]}"

    brief["evidence"] = posts
    brief["generated_at"] = now.isoformat()
    brief["cached"] = False

    existing = await session.get(AppConfig, ckey)
    if existing is None:
        session.add(AppConfig(key=ckey, value=brief, updated_at=now))
    else:
        existing.value = brief
        existing.updated_at = now
    await session.commit()
    return brief

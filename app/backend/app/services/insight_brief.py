"""On-demand AI briefing for one insight, grounded in its live scope.

The nightly analyst writes a conclusion from the corpus as it stood when the
cycle ran. This asks a different question — *given what the posts look like
right now*, what should someone actually do about this insight? — and answers
it from live measurements plus the newest posts in the insight's scope, not
from the frozen evidence the analyst happened to quote.

Grounding rules, in order (identical discipline to relationship_brief):
  * the numbers handed to the model are measured by insight_intel, never
    invented by the model,
  * the posts handed to the model are real rows pulled for this insight's
    scope, newest first,
  * product blurbs come from PRODUCT_GLOSSARY — the same source the nightly
    analyst is grounded in, so the two never contradict,
  * GLM unreachable => a deterministic measurement-only brief, clearly marked
    ``mode: "evidence"``, never a fabricated narrative.

Cache: ``app_config`` rows keyed ``insbrief:<version>:<insight-id>:<digest>``
where the digest covers the live measurements, so a brief self-invalidates
when the thing it describes actually moves — no TTL guessing, no migration.

Self-check (pure functions, no DB): ``python -m app.services.insight_brief``
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppConfig
from app.services.analysis.glm_client import GLM_BASE_URL, GLMError, _extract_json

logger = logging.getLogger("insight_brief")

BRIEF_VERSION = "insbrief-v1"
CACHE_TTL_HOURS = 24 * 3

SYSTEM_PROMPT = (
    "You are the community analyst for the Neutrinos Discourse forum — a real "
    "enterprise low-code platform. You are given ONE insight a previous "
    "analysis cycle concluded, the CURRENT measured state of the forum posts "
    "that insight covers, and the newest of those posts.\n\n"
    "Your job is not to restate the insight. It is to tell an engineering "
    "leader what to DO about it now, given the measurements. Treat the "
    "measurements as fact: if the scope is cooling, say the pressure is "
    "coming off; if it is surging, say so and why it matters. Never invent a "
    "number, a product capability, a person's role, or a cause the posts do "
    "not show.\n\n"
    "Answer with ONLY a JSON object:\n"
    '{"headline": str (one sentence, the state of this issue RIGHT NOW — not '
    'a restatement of the title), "so_what": str (2-3 sentences: what the '
    'current measurements mean for the team), "actions": [str] (2-4 concrete '
    'next steps, each one specific enough to assign to someone; empty list if '
    'the evidence genuinely does not support any), "drivers": [str] (2-4 '
    'short bullets naming what is actually driving the numbers, each citing a '
    'concrete detail from the posts), "watch_out": str (1 sentence: the risk '
    'of acting on this, or "" if none is supported), "confidence": '
    '"high|medium|low"}\n'
    "Set confidence low when the scope is small (under ~10 posts), the posts "
    "are old, or the posts do not explain the pattern. Do not pad. No "
    "markdown."
)


def measurement_digest(intel: dict) -> str:
    """Fingerprint of everything the brief's content depends on.

    Cache invalidation is content-addressed: if the scope size, momentum,
    severity or subject set changes, the key changes and a new brief is
    written. A brief therefore can never outlive the numbers it describes.
    """
    scope = intel.get("scope") or {}
    momentum = intel.get("momentum") or {}
    parts = [
        str(intel.get("id")),
        str(intel.get("severity")),
        str(scope.get("posts")),
        str(scope.get("negative_posts")),
        str(scope.get("high_priority_posts")),
        str(momentum.get("state")),
        str(momentum.get("recent_posts")),
        ",".join(sorted(s.get("key", "") for s in intel.get("subjects") or [])),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:20]


def cache_key(insight_id: int, digest: str) -> str:
    return f"insbrief:{BRIEF_VERSION}:{insight_id}:{digest}"


def build_prompt(intel: dict, posts: list[dict]) -> str:
    """The measured state + real posts, as JSON the model reads as fact."""
    scope = intel.get("scope") or {}
    momentum = intel.get("momentum") or {}
    series = intel.get("series") or []
    payload = {
        "insight": {
            "type": intel.get("insight_type"),
            "title": intel.get("title"),
            "body": intel.get("body"),
            "severity": intel.get("severity"),
            "first_seen": intel.get("first_seen"),
            "times_raised": (intel.get("lineage") or {}).get("cycles"),
        },
        "subjects": [
            {
                "name": s.get("label"),
                "kind": s.get("kind"),
                "what_it_is": s.get("description", ""),
                "posts_mentioning": s.get("posts"),
            }
            for s in (intel.get("subjects") or [])
        ],
        "measured_now": {
            "posts_in_scope": scope.get("posts"),
            "scope_mode": scope.get("mode"),
            "negative_posts": scope.get("negative_posts"),
            "high_priority_posts": scope.get("high_priority_posts"),
            "share_of_whole_forum": scope.get("corpus_share"),
            "days_since_last_post": scope.get("days_since_last_post"),
            "momentum_state": momentum.get("state"),
            "recent_posts": momentum.get("recent_posts"),
            "recent_window_days": momentum.get("recent_days"),
            "baseline_posts": momentum.get("baseline_posts"),
            "baseline_window_days": momentum.get("baseline_days"),
            "change_vs_baseline": momentum.get("delta_pct"),
        },
        "weekly_series": series[-8:],
        "newest_posts_in_scope": [
            {
                "topic": p.get("topic"),
                "excerpt": p.get("excerpt"),
                "created_at": p.get("created_at"),
                "was_cited_as_evidence": p.get("is_evidence"),
                "negative_sentiment": p.get("negative"),
                "high_priority": p.get("high_priority"),
            }
            for p in posts
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


_STATE_PHRASE = {
    "surging": "rising sharply against its own baseline",
    "rising": "rising against its own baseline",
    "steady": "holding steady against its own baseline",
    "cooling": "slowing against its own baseline",
    "dormant": "showing no posts at all in the recent window",
    "new": "newly active, with no earlier baseline to compare against",
}


def fallback_brief(intel: dict) -> dict:
    """Deterministic, measurement-only brief. Stated as such, never dressed up."""
    scope = intel.get("scope") or {}
    momentum = intel.get("momentum") or {}
    n = scope.get("posts") or 0
    recent = momentum.get("recent_posts") or 0
    state = momentum.get("state") or "dormant"
    names = [s.get("label") for s in (intel.get("subjects") or [])[:3] if s.get("label")]
    about = ", ".join(names) if names else "this insight"

    headline = (
        f"{about}: {n} post{'' if n == 1 else 's'} in scope, "
        f"{recent} in the last {momentum.get('recent_days', 14)} days — "
        f"{_STATE_PHRASE.get(state, state)}."
    )
    drivers = []
    neg = scope.get("negative_posts") or 0
    high = scope.get("high_priority_posts") or 0
    if neg:
        drivers.append(f"{neg} of the {n} posts in scope read as negative.")
    if high:
        drivers.append(f"{high} are classified high priority.")
    since = scope.get("days_since_last_post")
    if since is not None:
        drivers.append(
            "Newest post in scope is "
            + ("today." if since == 0 else f"{since} day{'' if since == 1 else 's'} old.")
        )
    return {
        "headline": headline,
        "so_what": "",
        "actions": [],
        "drivers": drivers,
        "watch_out": "",
        "confidence": "low",
        "mode": "evidence",
    }


def _coerce(payload: dict) -> dict:
    def _strlist(v, cap):
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        return [str(x).strip() for x in v if str(x).strip()][:cap]

    conf = str(payload.get("confidence", "medium")).lower()
    return {
        "headline": str(payload.get("headline", "")).strip(),
        "so_what": str(payload.get("so_what", "")).strip(),
        "actions": _strlist(payload.get("actions"), 4),
        "drivers": _strlist(payload.get("drivers"), 4),
        "watch_out": str(payload.get("watch_out", "")).strip(),
        "confidence": conf if conf in {"high", "medium", "low"} else "medium",
        "mode": "glm",
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
                # glm-5.x reasons by default and empties the content field.
                "thinking": {"type": "disabled"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "=== INSIGHT ===\n" + extract},
                ],
                "max_tokens": 1400,
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


async def get_brief(
    session: AsyncSession,
    intel: dict,
    posts: list[dict],
    refresh: bool = False,
) -> dict:
    insight_id = int(intel.get("id") or 0)
    digest = measurement_digest(intel)
    ckey = cache_key(insight_id, digest)
    now = datetime.now(timezone.utc)

    if not refresh:
        row = await session.get(AppConfig, ckey)
        if row is not None:
            age_h = (
                (now - row.updated_at).total_seconds() / 3600 if row.updated_at else 1e9
            )
            if age_h < CACHE_TTL_HOURS:
                cached = dict(row.value or {})
                cached["cached"] = True
                return cached

    if not posts:
        brief = fallback_brief(intel)
        brief["reason"] = "no posts found in this insight's scope"
    else:
        try:
            brief = _coerce(await _call_glm(build_prompt(intel, posts)))
        except Exception as exc:  # noqa: BLE001 — degrade, never 500 the page
            logger.info("insight brief fell back: %s: %s", type(exc).__name__, exc)
            brief = fallback_brief(intel)
            brief["reason"] = f"{type(exc).__name__}: {str(exc)[:200]}"

    brief["posts"] = posts
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


def _self_check() -> None:
    intel = {
        "id": 7,
        "severity": "high",
        "insight_type": "pain_point",
        "title": "Reels-Alpha integration blocks POCs",
        "body": "body",
        "subjects": [
            {"key": "product:reels", "label": "Reels", "kind": "product", "posts": 256},
            {"key": "product:alpha", "label": "Alpha Platform", "kind": "product", "posts": 757},
        ],
        "scope": {
            "posts": 42,
            "mode": "intersection",
            "negative_posts": 18,
            "high_priority_posts": 9,
            "corpus_share": 0.008,
            "days_since_last_post": 3,
        },
        "momentum": {
            "state": "rising",
            "recent_posts": 11,
            "baseline_posts": 14,
            "recent_days": 14,
            "baseline_days": 28,
            "delta_pct": 0.57,
        },
        "series": [{"week": "2026-09-21", "posts": 5, "negative": 2, "high": 1}],
        "lineage": {"cycles": 3},
    }

    d1 = measurement_digest(intel)
    assert d1 == measurement_digest(dict(intel)), "digest must be stable"
    moved = json.loads(json.dumps(intel))
    moved["momentum"]["recent_posts"] = 40
    assert measurement_digest(moved) != d1, "digest must move when the numbers move"
    assert cache_key(7, d1).startswith(f"insbrief:{BRIEF_VERSION}:7:")

    prompt = json.loads(build_prompt(intel, [{"topic": "T", "excerpt": "E"}]))
    assert prompt["measured_now"]["posts_in_scope"] == 42
    assert prompt["measured_now"]["momentum_state"] == "rising"
    assert prompt["subjects"][0]["name"] == "Reels"
    assert prompt["newest_posts_in_scope"][0]["topic"] == "T"

    fb = fallback_brief(intel)
    assert fb["mode"] == "evidence" and fb["confidence"] == "low"
    assert "42 posts in scope" in fb["headline"], fb["headline"]
    assert "11 in the last 14 days" in fb["headline"], fb["headline"]
    assert any("18 of the 42" in d for d in fb["drivers"]), fb["drivers"]
    assert fb["actions"] == [], "fallback must never invent actions"

    dormant = json.loads(json.dumps(intel))
    dormant["momentum"] = {"state": "dormant", "recent_posts": 0, "recent_days": 14}
    dormant["scope"]["days_since_last_post"] = 1
    fbd = fallback_brief(dormant)
    assert "no posts at all" in fbd["headline"], fbd["headline"]
    assert any("1 day old" in d for d in fbd["drivers"]), fbd["drivers"]

    c = _coerce(
        {
            "headline": " H ",
            "so_what": "S",
            "actions": "one action",
            "drivers": ["a", "", "b"],
            "confidence": "WRONG",
        }
    )
    assert c["headline"] == "H"
    assert c["actions"] == ["one action"], c["actions"]
    assert c["drivers"] == ["a", "b"]
    assert c["confidence"] == "medium", "unknown confidence must not pass through"
    assert c["mode"] == "glm"

    print("insight_brief self-check OK")


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

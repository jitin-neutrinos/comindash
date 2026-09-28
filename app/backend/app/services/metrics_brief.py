"""On-demand AI briefing for one metric slice, grounded in its measurements.

A chart shows a shape. A consultant tells you whether that shape is a problem,
what caused it, and what to do — and says so in the language of THIS product,
not generic analytics prose. That is what this produces, per metric tab.

Same grounding discipline as insight_brief / relationship_brief:
  * every number handed to the model is measured by metrics_intel,
  * anomaly dates, change points and movers are real detections, not vibes,
  * product names resolve through PRODUCT_GLOSSARY so the model never invents
    a capability the platform does not have,
  * GLM unreachable => deterministic measurement-only summary, labelled
    ``mode: "evidence"``. A fallback never wears the styling of analysis.

Cache key covers the metric, the window and a digest of the measurements, so a
brief self-invalidates the moment the numbers it describes change.

Self-check (pure functions, no DB): ``python -m app.services.metrics_brief``
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
from app.services.analysis.glm_client import (
    GLM_BASE_URL,
    PRODUCT_GLOSSARY,
    GLMError,
    _extract_json,
)

logger = logging.getLogger("metrics_brief")

BRIEF_VERSION = "metbrief-v1"
CACHE_TTL_HOURS = 12

METRIC_FRAMING = {
    "volume": (
        "You are looking at POSTING VOLUME on the forum. The question is "
        "whether engagement is healthy, where it concentrated, and whether "
        "any spike or quiet stretch needs explaining."
    ),
    "sentiment": (
        "You are looking at SENTIMENT. The question is whether community mood "
        "is deteriorating, and if so on what. A rising negative SHARE matters "
        "even when volume is flat — that is the signal to lead with."
    ),
    "priority": (
        "You are looking at the PRIORITY MIX of posts. The question is whether "
        "the support burden is growing: a rising high-priority share means "
        "more of what arrives is urgent, regardless of total volume."
    ),
    "entity": (
        "You are looking at ENTITY MENTIONS — which products, components and "
        "people the community is talking about. The question is what is "
        "gaining or losing attention, and what that implies for roadmap and "
        "support load."
    ),
}

SYSTEM_PROMPT = (
    "You are the community analytics consultant for Neutrinos, a real "
    "enterprise low-code platform. You are given MEASURED statistics from the "
    "Neutrinos Discourse forum for one metric over one time window, including "
    "detected anomalies, change points and movers.\n\n"
    "Treat every number as fact. Your job is to explain what the numbers mean "
    "for the team and what to do — the way a senior consultant writes the "
    "first page of a report. Never invent a number, a product capability, a "
    "cause the data does not support, or a person's role. When a detected "
    "anomaly has no visible explanation in the data, say it needs "
    "investigation rather than guessing a cause.\n\n"
    "Answer with ONLY a JSON object:\n"
    '{"headline": str (one sentence: the single most important thing this '
    'window shows), "assessment": str (2-4 sentences interpreting the '
    'measurements — lead with what changed and whether it is normal), '
    '"findings": [{"label": str (3-6 words), "detail": str (one sentence '
    'citing a specific measured number)}] (2-4 items), "actions": [str] (2-3 '
    'concrete next steps, each assignable; empty list if the data genuinely '
    'supports none), "watch_out": str (1 sentence naming the main way this '
    'data could mislead, or "" if none), "confidence": "high|medium|low"}\n'
    "Set confidence low when the sample is small (under ~50 labelled posts), "
    "the window is short, or model confidence on the slice is weak. No "
    "markdown, no padding."
)


def measurement_digest(intel: dict) -> str:
    """Fingerprint of the numbers a brief depends on.

    Content-addressed cache invalidation: when the measurements move, the key
    moves, so a brief can never outlive the data it describes.
    """
    metric = intel.get("metric")
    parts = [str(metric), str((intel.get("window") or {}).get("days"))]
    if metric == "volume":
        parts += [
            str(intel.get("total")),
            str(intel.get("change")),
            str(len(intel.get("anomalies") or [])),
            str((intel.get("change_point") or {}).get("date")),
        ]
    elif metric in {"sentiment", "priority"}:
        parts += [
            json.dumps(intel.get("shares") or {}, sort_keys=True),
            json.dumps(
                {k: v.get("delta") for k, v in (intel.get("drift") or {}).items()},
                sort_keys=True,
            ),
            str(intel.get("labelled_posts")),
        ]
    else:
        parts += [
            str(intel.get("total_mentions")),
            ",".join(str(r.get("key")) for r in (intel.get("risers") or [])),
            ",".join(str(f.get("key")) for f in (intel.get("fallers") or [])),
        ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:20]


def cache_key(metric: str, days: int, digest: str) -> str:
    return f"metbrief:{BRIEF_VERSION}:{metric}:{days}:{digest}"


def _glossary_for(intel: dict) -> dict:
    """Only the product blurbs relevant to this slice — a full glossary in
    every prompt wastes tokens and dilutes the useful entries."""
    metric = intel.get("metric")
    keys: set[str] = set()
    if metric == "entity":
        for row in (intel.get("by_category") or [])[:8]:
            keys.add(str(row.get("label")))
        for row in (intel.get("risers") or []) + (intel.get("fallers") or []):
            keys.add(str(row.get("category")))
    return {k: PRODUCT_GLOSSARY[k] for k in keys if k in PRODUCT_GLOSSARY}


def build_prompt(intel: dict) -> str:
    """Measured payload, trimmed to what the model can actually use."""
    metric = intel.get("metric")
    window = intel.get("window") or {}
    payload: dict = {
        "metric": metric,
        "what_this_metric_is": METRIC_FRAMING.get(metric, ""),
        "window": window,
    }

    if metric == "volume":
        payload["measured"] = {
            "total_posts": intel.get("total"),
            "daily_average": intel.get("daily_avg"),
            "busiest_day": intel.get("peak"),
            "days_with_no_posts": intel.get("quiet_days"),
            "first_half_daily_rate": intel.get("first_half_rate"),
            "second_half_daily_rate": intel.get("second_half_rate"),
            "relative_change": intel.get("change"),
            "change_point": intel.get("change_point"),
            "active_authors": intel.get("active_authors"),
            "busiest_threads": intel.get("top_topics"),
            "top_thread_share_of_posts": intel.get("top_topic_share"),
            "posting_by_weekday": intel.get("weekday"),
        }
        payload["anomalous_days"] = intel.get("anomalies")
    elif metric in {"sentiment", "priority"}:
        payload["measured"] = {
            "totals": intel.get("totals"),
            "shares": intel.get("shares"),
            "labelled_posts": intel.get("labelled_posts"),
            "mix_shift_first_half_to_second": intel.get("drift"),
            "model_confidence_on_this_slice": intel.get("avg_confidence"),
        }
        payload["anomalous_days"] = intel.get("anomalies")
        if metric == "sentiment":
            payload["measured"]["most_negative_day"] = intel.get("worst_day")
        else:
            payload["measured"]["threads_carrying_high_priority"] = intel.get("hot_topics")
    else:
        payload["measured"] = {
            "distinct_entities": intel.get("distinct_entities"),
            "total_mentions": intel.get("total_mentions"),
            "product_share_of_mentions": intel.get("product_share"),
            "most_mentioned": intel.get("top"),
            "by_category": intel.get("by_category"),
        }
        payload["gaining_attention"] = intel.get("risers")
        payload["losing_attention"] = intel.get("fallers")
        gl = _glossary_for(intel)
        if gl:
            payload["product_glossary"] = gl

    return json.dumps(payload, ensure_ascii=False)


def _pct(v) -> str:
    try:
        return f"{round(float(v) * 100)}%"
    except (TypeError, ValueError):
        return "—"


def fallback_brief(intel: dict) -> dict:
    """Deterministic, measurement-only summary. Labelled as such."""
    metric = intel.get("metric")
    findings: list[dict] = []
    headline = ""

    if metric == "volume":
        total = intel.get("total") or 0
        change = intel.get("change")
        direction = (
            "no baseline to compare against"
            if change is None
            else f"{'up' if change >= 0 else 'down'} {_pct(abs(change))} versus the first half"
        )
        headline = f"{int(total)} posts in this window, {direction}."
        peak = intel.get("peak") or {}
        if peak:
            findings.append(
                {"label": "Busiest day", "detail": f"{peak.get('date')} with {int(peak.get('value', 0))} posts."}
            )
        if intel.get("active_authors"):
            findings.append(
                {"label": "Active authors", "detail": f"{intel['active_authors']} distinct authors posted."}
            )
    elif metric in {"sentiment", "priority"}:
        shares = intel.get("shares") or {}
        key = "neg" if metric == "sentiment" else "high"
        word = "negative" if metric == "sentiment" else "high priority"
        headline = (
            f"{_pct(shares.get(key))} of {int(intel.get('labelled_posts') or 0)} labelled posts "
            f"are {word} in this window."
        )
        drift = (intel.get("drift") or {}).get(key) or {}
        if drift.get("delta") is not None:
            findings.append(
                {
                    "label": "Mix shift",
                    "detail": f"{word.capitalize()} share moved from {_pct(drift.get('before'))} to {_pct(drift.get('after'))} across the window.",
                }
            )
        if intel.get("avg_confidence"):
            findings.append(
                {"label": "Model confidence", "detail": f"Average {_pct(intel['avg_confidence'])} on this slice."}
            )
    else:
        top = (intel.get("top") or [{}])[0]
        headline = (
            f"{int(intel.get('distinct_entities') or 0)} distinct entities mentioned; "
            f"{top.get('label', '—')} leads with {int(top.get('count', 0))} posts."
        )
        for r in (intel.get("risers") or [])[:2]:
            findings.append(
                {
                    "label": f"Rising: {r.get('label')}",
                    "detail": (
                        f"New in the second half with {int(r.get('after', 0))} posts."
                        if r.get("status") == "new"
                        else f"Up {_pct(r.get('change'))} to {int(r.get('after', 0))} posts."
                    ),
                }
            )

    anomalies = intel.get("anomalies") or []
    if anomalies:
        a = anomalies[0]
        findings.append(
            {
                "label": "Unusual day detected",
                "detail": f"{a.get('date')} is a statistical {a.get('direction')} (score {a.get('score')}).",
            }
        )

    return {
        "headline": headline,
        "assessment": "",
        "findings": findings[:4],
        "actions": [],
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

    findings = []
    raw = payload.get("findings")
    if isinstance(raw, list):
        for f in raw[:4]:
            if isinstance(f, dict):
                label = str(f.get("label", "")).strip()
                detail = str(f.get("detail", "")).strip()
                if label or detail:
                    findings.append({"label": label, "detail": detail})
            elif str(f).strip():
                findings.append({"label": "", "detail": str(f).strip()})

    conf = str(payload.get("confidence", "medium")).lower()
    return {
        "headline": str(payload.get("headline", "")).strip(),
        "assessment": str(payload.get("assessment", "")).strip(),
        "findings": findings,
        "actions": _strlist(payload.get("actions"), 3),
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
                "thinking": {"type": "disabled"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": "=== MEASURED DATA ===\n" + extract},
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


def has_data(intel: dict) -> bool:
    """Whether the slice has enough measured data to brief on at all."""
    metric = intel.get("metric")
    if metric == "volume":
        return (intel.get("total") or 0) > 0
    if metric in {"sentiment", "priority"}:
        return (intel.get("labelled_posts") or 0) > 0
    return (intel.get("total_mentions") or 0) > 0


async def get_brief(
    session: AsyncSession, intel: dict, refresh: bool = False
) -> dict:
    metric = str(intel.get("metric"))
    days = int((intel.get("window") or {}).get("days") or 30)
    digest = measurement_digest(intel)
    ckey = cache_key(metric, days, digest)
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

    if not has_data(intel):
        brief = fallback_brief(intel)
        brief["reason"] = "no data in this window"
    else:
        try:
            brief = _coerce(await _call_glm(build_prompt(intel)))
        except Exception as exc:  # noqa: BLE001 — degrade, never 500 the page
            logger.info("metrics brief fell back: %s: %s", type(exc).__name__, exc)
            brief = fallback_brief(intel)
            brief["reason"] = f"{type(exc).__name__}: {str(exc)[:200]}"

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
    vol = {
        "metric": "volume",
        "window": {"days": 30},
        "total": 420,
        "daily_avg": 14.0,
        "peak": {"date": "2026-09-12", "value": 51},
        "quiet_days": 3,
        "change": 0.35,
        "change_point": {"index": 12, "date": "2026-09-12"},
        "anomalies": [{"date": "2026-09-12", "direction": "spike", "score": 4.1}],
        "active_authors": 37,
        "top_topics": [{"label": "Alpha upgrade", "count": 40}],
        "top_topic_share": 0.095,
        "weekday": [{"day": "Mon", "avg": 12}],
    }

    d1 = measurement_digest(vol)
    assert d1 == measurement_digest(json.loads(json.dumps(vol))), "digest must be stable"
    moved = json.loads(json.dumps(vol))
    moved["total"] = 999
    assert measurement_digest(moved) != d1, "digest must move when data moves"
    assert cache_key("volume", 30, d1).startswith(f"metbrief:{BRIEF_VERSION}:volume:30:")
    # different windows must not share a cache entry
    assert cache_key("volume", 7, d1) != cache_key("volume", 30, d1)

    p = json.loads(build_prompt(vol))
    assert p["measured"]["total_posts"] == 420
    assert p["anomalous_days"][0]["date"] == "2026-09-12"
    assert "POSTING VOLUME" in p["what_this_metric_is"]

    fb = fallback_brief(vol)
    assert fb["mode"] == "evidence" and fb["confidence"] == "low"
    assert "420 posts" in fb["headline"], fb["headline"]
    assert "up 35%" in fb["headline"], fb["headline"]
    assert fb["actions"] == [], "fallback must never invent actions"
    assert any("Unusual day" in f["label"] for f in fb["findings"]), fb["findings"]

    # no-baseline volume must not claim a direction
    nb = json.loads(json.dumps(vol))
    nb["change"] = None
    assert "no baseline" in fallback_brief(nb)["headline"]

    sent = {
        "metric": "sentiment",
        "window": {"days": 30},
        "shares": {"pos": 0.1, "neu": 0.6, "neg": 0.3},
        "drift": {"neg": {"before": 0.18, "after": 0.31, "delta": 0.13}},
        "labelled_posts": 240,
        "avg_confidence": 0.82,
        "anomalies": [],
    }
    fbs = fallback_brief(sent)
    assert "30% of 240 labelled posts are negative" in fbs["headline"], fbs["headline"]
    assert any("18%" in f["detail"] and "31%" in f["detail"] for f in fbs["findings"])
    assert measurement_digest(sent) != measurement_digest(vol)

    ent = {
        "metric": "entity",
        "window": {"days": 30},
        "distinct_entities": 88,
        "total_mentions": 640,
        "top": [{"label": "Alpha Platform", "count": 210, "category": "alpha"}],
        "by_category": [{"label": "alpha", "count": 210}],
        "risers": [
            {"key": "reels:x", "label": "Reels", "category": "reels", "after": 30, "change": 0.9, "status": "changed"},
            {"key": "studio:y", "label": "Studio", "category": "studio", "after": 12, "status": "new"},
        ],
        "fallers": [],
    }
    fbe = fallback_brief(ent)
    assert "Alpha Platform leads" in fbe["headline"], fbe["headline"]
    assert any("Rising: Reels" in f["label"] for f in fbe["findings"])
    assert any("New in the second half" in f["detail"] for f in fbe["findings"])
    gl = _glossary_for(ent)
    assert "alpha" in gl, gl

    assert has_data(vol) and has_data(sent) and has_data(ent)
    assert not has_data({"metric": "volume", "total": 0})
    assert not has_data({"metric": "sentiment", "labelled_posts": 0})

    c = _coerce(
        {
            "headline": " H ",
            "assessment": "A",
            "findings": [{"label": "L", "detail": "D"}, "bare string", {}],
            "actions": "single",
            "confidence": "NOPE",
        }
    )
    assert c["headline"] == "H"
    assert c["findings"][0] == {"label": "L", "detail": "D"}
    assert c["findings"][1]["detail"] == "bare string"
    assert len(c["findings"]) == 2, "empty finding must be dropped"
    assert c["actions"] == ["single"]
    assert c["confidence"] == "medium", "unknown confidence must not pass through"
    assert c["mode"] == "glm"

    print("metrics_brief self-check OK")


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

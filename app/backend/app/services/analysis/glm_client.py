"""GLM assistant client (pipeline-v3): z.ai glm-4.5-flash, free tier.

Replaces the AI Hub assistant. The nightly cycle builds the analysis extract,
asks GLM for the JSON insights payload, and pushes it through the SAME
insights_gate as the external ingest path — identical validation, identical
audit trail. Failures degrade to skip mode (never crash the worker).

Config via env:
  GLM_API_KEY   — z.ai API key (required; missing → skip mode)
  GLM_MODEL     — default glm-4.5-flash (free; glm-5.3-flash has no balance)
"""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

logger = logging.getLogger("analysis.glm")

GLM_BASE_URL = os.environ.get("GLM_BASE_URL", "https://api.z.ai/api/coding/paas/v4/chat/completions")
ASSISTANT_VERSION = "glm-5.3-v1"

SYSTEM_PROMPT = (
    "You are the community analyst for the Neutrinos Discourse forum. You "
    "receive an analysis extract: forum posts with priority, sentiment and "
    "entities, plus aggregate counts. Identify real pain points, trends, "
    "anomalies and component relationships. Answer with ONLY a JSON object, "
    "no markdown fences, matching exactly:\n"
    '{"insights": [{"insight_type": "pain_point|trend|anomaly|relationship|'
    'recommendation", "title": str (<=200 chars), "body": str, "severity": '
    '"high|medium|low", "evidence": [{"discourse_post_id": int FROM THE '
    'EXTRACT, "quote": str (verbatim from that post, <=200 chars), '
    '"relevance_note": str}], "relationships": [{"subject_type": "entity", '
    '"subject_value": str, "relation": str, "object_type": "topic", '
    '"object_value": str, "strength": 0.0-1.0}]}]}\n'
    "Rules: 3-8 insights. Every insight needs 1-3 evidence items whose "
    "discourse_post_id appears in the extract. Quote text verbatim. Severity "
    "high only for things breaking users now or security exposure."
)


class GLMError(Exception):
    pass


def _extract_json(content: str) -> dict:
    """Tolerant JSON extraction (handles prose around the object)."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise GLMError("no JSON object in reply")
    return json.loads(text[start : end + 1])


async def request_insights(extract_json: str) -> dict:
    """One GLM call over the extract. Returns the parsed payload dict.

    Raises GLMError on any failure — caller degrades to skip mode.
    """
    api_key = os.environ.get("GLM_API_KEY", "")
    if not api_key:
        raise GLMError("GLM_API_KEY not set")
    model = os.environ.get("GLM_MODEL", "glm-4.5-flash")

    async with httpx.AsyncClient(timeout=240.0) as client:
        resp = await client.post(
            GLM_BASE_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                # glm-4.5-flash thinks by default; thinking burns the whole
                # token budget on reasoning_content and returns empty content.
                "thinking": {"type": "disabled"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": "=== ANALYSIS EXTRACT ===\n" + extract_json,
                    },
                ],
                "max_tokens": 4096,
                "temperature": 0.3,
            },
        )
    if resp.status_code == 429:
        try:
            detail = resp.json().get("error", {}).get("message", "")
        except Exception:  # noqa: BLE001
            detail = ""
        raise GLMError(f"GLM 429 rate limited/blocked: {detail[:200]}")
    resp.raise_for_status()
    data = resp.json()
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise GLMError("empty GLM reply")
    payload = _extract_json(content)
    if not isinstance(payload.get("insights"), list) or not payload["insights"]:
        raise GLMError("reply JSON has no insights array")
    return payload

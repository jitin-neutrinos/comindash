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
ASSISTANT_VERSION = "glm-5.3-v2-product-context"

# Grounded in documentation.neutrinos.com (mcp__neutrinos_docs__search_docs,
# verified 2026-09-28) — real product descriptions, not GLM-hallucinated
# guesses. Keys match ml/pipeline/inference_server.py GLINER_LABELS so entity
# labels in the extract resolve to real product context instead of bare
# lowercase tags the model has to guess at.
PRODUCT_GLOSSARY = {
    "alpha": "Alpha Platform — low-code workflow/rules engine; Workflow Studio "
             "builds triggers and case-management flows, executed via the Workbench inbox.",
    "trinity": "Trinity 2.0 — cloud hosting platform for deployed apps: CI/CD from "
               "Azure DevOps/GitHub/Docker Hub, app/data/user management, reporting.",
    "pulse": "Pulse — rules/workflow publication layer: configures triggers "
             "(immediate or CRON), integrates rules/workflows/master data via generated Swagger APIs.",
    "reels": "Reels — rules engine (Reels Engine) that evaluates and executes "
             "business rules via REST APIs; built for high-volume decisioning.",
    "reels_engine": "Reels Engine — the rule-execution runtime inside Reels; Alpha "
                    "and Pulse trigger Reels rules/workflows by tag or version.",
    "workbench": "Workbench — the Alpha Platform's low-code case/task workspace: "
                 "inbox, case assignment, task states, layouts.",
    "ssd": "Server Services Designer (SSD) — drag-and-drop flow builder for "
           "server-side business logic and HTTP endpoints (via Studio).",
    "csd": "Client Services Designer (CSD) — flow builder for client-side "
           "business logic, companion to SSD.",
    "ai_hub": "AI Hub — Neutrinos' AI SDK/framework (InferenceSDK): classification, "
              "extraction and assistant services, batch + single-call APIs for AI-driven workflows.",
    "studio": "Neutrinos Studio — the core app builder: pages, widgets, plugins, "
              "app templates; the IDE most Neutrinos apps are built in.",
    # "modelr" and "components" removed 2026-09-28: posts use "model"/
    # "component" as plain English words, not product references -- noise.
    "hypha": "Hypha — unified data layer/architecture across on-prem, cloud and "
             "edge sources: object framework, workspace, business object management.",
    "identity_server": "Identity Server (IDS) — OAuth 2.0 + OpenID Connect provider: "
                        "authentication, SSO, token issuance for all Neutrinos apps.",
    "plugins_builder": "Plugins Builder — Studio tool to build custom nodes/plugins "
                       "consumable from Page Designer, SSD and CSD.",
    "data_fabric": "Data Fabric — architectural layer unifying data across sources "
                   "with governed access; object framework, metadata, relationships.",
    "flow_designer": "Flow Designer — page/service flow builder: nodes, lifecycle "
                     "events, dialogs, script/date/IndexedDB nodes.",
    "app_builder": "App Builder — Studio's app-creation and template management UI.",
    "srm_platform": "SRM Platform — sales/relationship management: contacts, deals, "
                    "team stats, admin user/role management.",
    "art_api": "ART API — Neutrinos' API runtime engine; REST endpoints for data "
               "model, index and authorization management.",
}


def _glossary_block() -> str:
    lines = [f"- {k}: {v}" for k, v in PRODUCT_GLOSSARY.items()]
    return "Neutrinos product glossary (ground every product reference in this, never guess):\n" + "\n".join(lines)


SYSTEM_PROMPT = (
    "You are the community analyst for the Neutrinos Discourse forum, a real "
    "enterprise low-code platform. You receive an analysis extract: forum "
    "posts with priority, sentiment and entities (products, people, "
    "co-occurrence pairs), plus aggregate counts.\n\n"
    + _glossary_block() + "\n\n"
    "Ground every insight in what these products actually do — do not invent "
    "capabilities. Use entity co-occurrence pairs (format 'X + Y') to find "
    "real cross-component relationships (e.g. a person repeatedly tied to "
    "one product signals a support hotspot or ownership; two products tied "
    "together signals an integration pain point). Prefer insights that name "
    "the specific product over generic 'the platform'.\n\n"
    "Identify real pain points, trends, anomalies and component "
    "relationships. Answer with ONLY a JSON object, no markdown fences, "
    "matching exactly:\n"
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

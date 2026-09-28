#!/usr/bin/env python3
"""Inference sidecar: Laya (priority+sentiment) + GLiNER (NER) over HTTP.

One process, host-run (not containerised: models live in ~/.cache/huggingface
and the fine-tune in ml/laya/checkpoints). The backend containers call this
over 127.0.0.1:8101 — no torch inside docker, no GPU wiring in compose.

Endpoints:
  GET  /health        -> {"status":"ok","laya":true,"gliner":true}
  POST /classify      -> {"texts": [..]} -> per-text priority+sentiment
  POST /extract       -> {"texts": [..]} -> per-text entity list w/ char offsets

Run:  ml/laya/.venv/bin/python ml/pipeline/inference_server.py
"""

from __future__ import annotations

import logging
import os
import threading

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("inference")

HERE = os.path.dirname(os.path.abspath(__file__))
CKPT = os.path.join(HERE, "..", "laya", "checkpoints", "insights-v1")
# Fine-tuned 2026-09-27 (macro F1 89.6% on holdout vs 43% zero-shot avg across
# person/product/email — see ml/gliner_finetune.log). Falls back to the
# zero-shot base model if the checkpoint is ever missing/moved.
# forum-v3 (2026-09-28): retrained on 10 explicit vocab labels mined from real
# forum posts (1406+ real mentions + 60 hard-negative API/GitHub posts to fix
# ai_hub false positives) + existing gold person/email data. Held-out check
# (disjoint 15-row sample, not the auto-eval's broken split -- see
# docs/ner-train-plan-2026-09-27.md "known limits"): ai_hub P=100% R=84% F1=91%,
# up from 43% zero-shot; ssd 92%, studio 95%, trinity 95%, components 84%,
# person 97%, no regression anywhere. Labels not in the 10-label training set
# (pulse, hypha, csd, workbench, modelr, data_fabric, flow_designer,
# app_builder, srm_platform, art_api, reels_engine, plugins_builder) still run
# zero-shot through this same checkpoint -- GLiNER's span-matching head
# generalizes to novel labels regardless of fine-tuning on others.
GLINER_CKPT = os.path.join(HERE, "..", "gliner", "checkpoints", "forum-v3")

PRIORITY_Q = {
    "type": "choice",
    "instructions": "How urgent is this forum post? Classify its priority.",
    "criteria": {
        "low": "General discussion, questions, marketing or case-study content, or announcements with no required reader action.",
        "medium": "Guides, how-tos, reference material, POC showcases, or release notes without breaking changes, security fixes, or mandatory actions.",
        "high": "Something that, unread, breaks someone's work right now, breaks production for everyone, or carries security/legal exposure -- the reader must act or lose something. Includes blocked work with a named victim, security vulnerabilities or CVEs, critical ops advisories, and release notes with breaking changes, security fixes, or mandatory migrations.",
    },
}
SENTIMENT_Q = {
    "type": "choice",
    "instructions": "What is the emotional tone of this forum post?",
    "criteria": {
        "pos": "The writer expresses satisfaction, gratitude, or relief about something that happened -- thanks or works-now confirmations, genuine praise, or positive progress updates.",
        "neu": "Neutral tone -- factual statements, policy statements, questions, or announcements without strong positive or negative emotion.",
        "neg": "The writer expresses frustration, a fault report, or an unresolved problem -- something is not working and the sentence does not resolve it.",
    },
}
# Domain vocabulary: Neutrinos products and names only (verified from docs MCP + user's directive 2026-09-27).
# All terms backed by docs publications (list_publications verified live) or user's explicit instruction.
# Per GLiNER2 docs (github/fastino-ai/GLiNER2): descriptions improve matching accuracy for domain labels.
GLINER_LABELS = [
    {"label": "alpha", "description": "Neutrinos Alpha rules/triggers platform product"},
    {"label": "trinity", "description": "Neutrinos Trinity platform component"},
    {"label": "pulse", "description": "Neutrinos Pulse releases and triggers publication"},
    {"label": "reels", "description": "Neutrinos Reels Engine integration component"},
    {"label": "reels_engine", "description": "Neutrinos Reels Engine (Reels platform) product"},
    {"label": "workbench", "description": "Neutrinos Workbench developer interface"},
    {"label": "ssd", "description": "Neutrinos Server Side Service Designer (SSD) component"},
    {"label": "csd", "description": "Neutrinos Client Services Designer (CSD) component"},
    {"label": "ai_hub", "description": "Neutrinos AI Hub framework and SDK"},
    {"label": "studio", "description": "Neutrinos Studio widget/app builder"},
    {"label": "modelr", "description": "Neutrinos Modelr model-building component"},
    {"label": "hypha", "description": "Neutrinos Hypha platform component"},
    {"label": "identity_server", "description": "Neutrinos Identity Server"},
    {"label": "plugins_builder", "description": "Neutrinos Plugins Builder"},
    {"label": "components", "description": "Neutrinos platform Components module"},
    {"label": "data_fabric", "description": "Neutrinos Data Fabric"},
    {"label": "flow_designer", "description": "Neutrinos Flow Designer"},
    {"label": "app_builder", "description": "Neutrinos App Builder"},
    {"label": "srm_platform", "description": "Neutrinos SRM Platform"},
    {"label": "art_api", "description": "Neutrinos ART API"},
    # Person names used in posts (user directive: "all names we need to extract") — kept, no suppression.
    {"label": "person", "description": "Person or individual names mentioned in posts and evidence"},
    # Email addresses (verified by regex backstop; real email extraction, not @mentions).
    {"label": "email", "description": "Email addresses (verified by regex)"},
]
# Note: product is kept in the vocabulary (as domain terms above); the generic "product" label is removed
# to avoid false positive generic flags (IDS/BPM/SSD flagged wrongly in audit — PRODUCT F1 72%).
# All target product names are now explicit vocabulary terms.

# For basic predict_entities, pass the label list only (GLiNER supports simple string array or dict array with description).
# The dict form (label + description) improves domain accuracy per GLiNER2 docs.
GLINER_LABEL_ARRAY = [l["label"] for l in GLINER_LABELS]

# Measured 2026-09-27 (docs/model-audit-2026-09-27.md): GLiNER's zero-shot EMAIL
# label mostly fires on bare @mentions, not real addresses (41% F1). A regex
# backstop for real addresses + a filter that drops non-matching "email"
# predictions took the same sample to P=83% R=90% F1=86%.
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

MODELS_LOCK = threading.Lock()
MODELS: dict = {}


def load_models() -> None:
    from laya.agent import Agent
    from gliner import GLiNER

    device = "cuda" if os.environ.get("SIDECAR_FORCE_CPU", "") != "1" else "cpu"
    log.info("loading Laya from %s (device=%s)", CKPT, device)
    MODELS["laya"] = Agent(CKPT, device=device)
    if os.path.isdir(GLINER_CKPT):
        log.info("loading fine-tuned GLiNER checkpoint from %s", GLINER_CKPT)
        MODELS["gliner"] = GLiNER.from_pretrained(GLINER_CKPT)
    else:
        log.info("fine-tuned checkpoint not found, loading zero-shot urchade/gliner_medium-v2.1")
        MODELS["gliner"] = GLiNER.from_pretrained("urchade/gliner_medium-v2.1")
    if device == "cuda":
        MODELS["gliner"] = MODELS["gliner"].to("cuda")
    log.info("models ready")


def classify(texts: list[str]) -> list[dict]:
    out = []
    with MODELS_LOCK:
        for t in texts:
            r = MODELS["laya"].predict(t or " ", {"priority": PRIORITY_Q, "sentiment": SENTIMENT_Q})
            p, s = r["answers"]["priority"], r["answers"]["sentiment"]
            out.append(
                {
                    "priority": p["choice"],
                    "priority_confidence": p["answer_confidence"],
                    "sentiment": s["choice"],
                    "sentiment_confidence": s["answer_confidence"],
                }
            )
    return out


def extract(texts: list[str]) -> list[list[dict]]:
    out = []
    with MODELS_LOCK:
        for t in texts:
            text = t or " "
            ents = MODELS["gliner"].predict_entities(text, GLINER_LABEL_ARRAY, threshold=0.75)
            results: list[dict] = []
            seen_spans: set[tuple[int, int]] = set()
            for e in ents:
                if e["label"] == "email" and not _EMAIL_RE.fullmatch(e["text"].strip()):
                    continue  # @mention misclassified as email, drop it
                span = (e["start"], e["end"])
                if span in seen_spans:
                    continue
                seen_spans.add(span)
                results.append(
                    {
                        "entity_text": e["text"],
                        "entity_label": e["label"],
                        "start_pos": e["start"],
                        "end_pos": e["end"],
                        "confidence": round(float(e.get("score", 0.0)), 4),
                    }
                )
            for m in _EMAIL_RE.finditer(text):  # backstop for real addresses GLiNER missed
                span = (m.start(), m.end())
                if span in seen_spans:
                    continue
                seen_spans.add(span)
                results.append(
                    {
                        "entity_text": m.group(0),
                        "entity_label": "email",
                        "start_pos": m.start(),
                        "end_pos": m.end(),
                        "confidence": 0.95,
                    }
                )
            results.sort(key=lambda r: r["start_pos"])
            # C: co-occurrence pairs — connect person + domain product when they appear together (verified 2026-09-27).
            person_spans = [(r["start_pos"], r["end_pos"], r["entity_text"], r["entity_label"]) for r in results if r["entity_label"] == "person"]
            domain_spans = [(r["start_pos"], r["end_pos"], r["entity_text"], r["entity_label"]) for r in results if r["entity_label"] not in ("email", "person")]
            co_occurrences: list[dict] = []
            for p_start, p_end, p_text, p_label in person_spans:
                for d_start, d_end, d_text, d_label in domain_spans:
                    # co-occurring if spans overlap or are within 80 chars in same text
                    if max(p_start, d_start) - min(p_end, d_end) < 80:
                        co_occurrences.append({
                            "entity_text": f"{p_text} + {d_text}",
                            "entity_label": "co_occurrence",
                            "start_pos": min(p_start, d_start),
                            "end_pos": max(p_end, d_end),
                            "confidence": 0.85,
                            "person_text": p_text,
                            "person_label": p_label,
                            "domain_text": d_text,
                            "domain_label": d_label,
                        })
            # Deduplicate co_occurrences by (person_text+domain_text, start_pos)
            seen_co: set = set()
            unique_co: list[dict] = []
            for co in co_occurrences:
                co_key = (co["person_text"], co["domain_text"], co["start_pos"])
                if co_key not in seen_co:
                    seen_co.add(co_key)
                    unique_co.append(co)
            results.extend(unique_co)
            results.sort(key=lambda r: r["start_pos"])
            out.append(results)
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet default request logging
        pass

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send(200, {"status": "ok", "laya": "laya" in MODELS, "gliner": "gliner" in MODELS})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n) or b"{}")
            texts = payload.get("texts")
            if not isinstance(texts, list) or not texts:
                self._send(422, {"error": "body must be {\"texts\": [..]}"})
                return
            if len(texts) > 500:
                self._send(422, {"error": "max 500 texts per call"})
                return
            if self.path == "/classify":
                self._send(200, {"results": classify(texts)})
            elif self.path == "/extract":
                self._send(200, {"results": extract(texts)})
            else:
                self._send(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001
            log.exception("request failed")
            self._send(500, {"error": str(exc)[:300]})


def main() -> None:
    load_models()
    host = os.environ.get("SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("SIDECAR_PORT", "8101"))
    srv = ThreadingHTTPServer((host, port), Handler)
    log.info("inference sidecar listening on %s:%s", host, port)
    srv.serve_forever()


if __name__ == "__main__":
    main()

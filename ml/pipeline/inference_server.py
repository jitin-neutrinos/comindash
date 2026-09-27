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
GLINER_CKPT = os.path.join(HERE, "..", "gliner", "checkpoints", "forum-v2")

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
GLINER_LABELS = ["person", "product", "email"]

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
            ents = MODELS["gliner"].predict_entities(text, GLINER_LABELS, threshold=0.5)
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

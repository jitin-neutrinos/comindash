"""NER -> extractions table.

Real mode: AI Hub text extraction. Per ai-hub/integrate-apis-text-extraction the
response carries entities in two places::

    "output": {"entities": [{"entity": "State", "text": "Karnataka",
                             "confidence": 0.996}]}
    "result": {"row_0": [{"entity": ..., "text": ..., "confidence": ...,
                          "position": {"start": 0, "end": 9}},
                         {"summary": [...]}]}

``result`` is preferred because only it carries character positions; ``output``
is the fallback. Note the label field is ``entity`` (not ``label``/``type``)
and the surface form is ``text``.

Stub mode (no ``AIHUB_TOKEN_NER``): deterministic regex NER, ``stub-1``.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Extraction, Post
from app.services.aihub import _stage
from app.services.aihub._stage import STUB_VERSION
from app.services.aihub.client import AIHubClient

STUB_PATTERNS: list[tuple[str, str]] = [
    ("URL", r"https?://[^\s<>\"')\]]+"),
    ("EMAIL", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    ("ERROR_CODE", r"\b[A-Z]{2,}[-_]\d{2,}\b"),
    ("VERSION", r"\bv?\d+\.\d+(\.\d+)?\b"),
    ("PATH", r"(?:^|\s)(/[A-Za-z0-9][\w./-]*)"),
    (
        "PRODUCT",
        r"\b(Neutrinos Studio|Studio|Platform|Debugger|Connector|Qore|SDK|API)\b",
    ),
    ("ENTITY", r"\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){1,2})\b"),
]

_MAX_ENTITIES_PER_POST = 20


def stub_ner(text: str) -> list[dict]:
    """Deterministic regex NER. Returns dicts with entity_text/label/positions."""
    found: list[dict] = []
    taken: list[tuple[int, int]] = []
    for label, pattern in STUB_PATTERNS:
        for m in re.finditer(pattern, text or ""):
            span = (m.start(), m.end())
            if any(s < span[1] and span[0] < e for s, e in taken):
                continue  # higher-priority label already claimed this span
            taken.append(span)
            found.append(
                {
                    "entity_text": m.group(0).strip(),
                    "entity_label": label,
                    "start_pos": m.start(),
                    "end_pos": m.end(),
                    "confidence": min(0.9, 0.55 + 0.05 * len(m.group(0))),
                }
            )
            if len(found) >= _MAX_ENTITIES_PER_POST:
                return found
    found.sort(key=lambda e: e["start_pos"])
    return found


def _entity_row(e: dict) -> dict | None:
    text = str(e.get("text") or "").strip()
    label = str(e.get("entity") or e.get("label") or "ENTITY")
    if not text:
        return None
    position = e.get("position") or {}
    try:
        confidence = float(e.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "entity_text": text,
        "entity_label": label,
        "start_pos": int(position.get("start") or 0),
        "end_pos": int(position.get("end") or len(text)),
        "confidence": confidence,
    }


def parse_result(payload: dict) -> list[dict]:
    """AI Hub extraction document -> extraction rows (positions preferred)."""
    rows: list[dict] = []
    result = payload.get("result")
    items: list = []
    if isinstance(result, dict):
        for value in result.values():  # row_0, row_1, ...
            if isinstance(value, list):
                items.extend(value)
    elif isinstance(result, list):
        items = result
    for item in items:
        if not isinstance(item, dict) or "summary" in item:
            continue  # trailing per-row summary block, not an entity
        row = _entity_row(item)
        if row:
            rows.append(row)
    if rows:
        return rows[:_MAX_ENTITIES_PER_POST]
    # fallback: output.entities has no positions
    for item in (payload.get("output") or {}).get("entities") or []:
        if isinstance(item, dict):
            row = _entity_row(item)
            if row:
                rows.append(row)
    return rows[:_MAX_ENTITIES_PER_POST]


def model_version(payload: dict | None) -> str:
    if not payload:
        return STUB_VERSION
    return str(payload.get("training_id") or payload.get("model_version") or "aihub-1")


async def run_extraction(
    session: AsyncSession, run_id: int | None = None, post_ids: list[int] | None = None
) -> dict:
    """Extract entities for posts this stage has not seen yet. Stub-safe.

    A post that yields zero entities is still marked analysed — otherwise it is
    re-processed (and re-billed) on every run forever.
    """
    own_run = run_id is None
    if own_run:
        run_id = await _stage.open_run(session, "extraction")

    client = AIHubClient("ner", run_id=run_id)
    mode = "aihub" if client.is_configured else "stub"

    if post_ids is None:
        pending = await _stage.pending_posts(session, "ner")
    else:
        rows = await session.execute(
            select(Post.id, Post.body_text).where(Post.id.in_(post_ids))
        )
        pending = [(r[0], r[1] or "") for r in rows]

    now = datetime.now(timezone.utc)
    done_by_version: dict[str, list[int]] = {}
    extracted = 0
    errors: list[str] = []
    failed = 0

    if pending:
        results, errors, failed = await _stage.analyse_texts(
            client, [t for _, t in pending], stub_ner
        )
        for (pid, _text), payload in zip(pending, results):
            if payload is None:
                continue
            if client.is_configured:
                entities = parse_result(payload)
                version = model_version(payload)
                result_id = payload.get("_id") or payload.get("id")
                result_id = str(result_id) if result_id else None
            else:
                entities, version, result_id = payload, STUB_VERSION, None
            for ent in entities:
                session.add(
                    Extraction(
                        post_id=pid,
                        run_id=run_id,
                        model_version=version,
                        aihub_result_id=result_id,
                        created_at=now,
                        **ent,
                    )
                )
            extracted += len(entities)
            done_by_version.setdefault(version, []).append(pid)
        for version, ids in done_by_version.items():
            await _stage.mark_analysed(session, "ner", ids, version)

    stored = sum(len(v) for v in done_by_version.values())
    stats = {
        "stage": "extraction",
        "mode": mode,
        "posts": len(pending),
        "analysed": stored,
        "entities": extracted,
        "failed": failed,
    }
    if errors:
        stats["errors"] = errors
    if failed and not stored and pending:
        stats["error"] = f"all {failed} extraction calls failed: {errors[0][:300]}"

    if own_run:
        await _stage.close_run(session, run_id, stats, f"extraction:{mode}")
        await session.commit()
    else:
        await session.flush()
    return stats

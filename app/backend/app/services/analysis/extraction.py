"""NER -> extractions table.

Deterministic regex NER, stamped ``model_version="stub-1"``.

# TODO(pipeline-v3): replace stub with local model / GLM call
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Extraction, Post
from app.services.analysis import _stage
from app.services.analysis._stage import STUB_VERSION

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


async def run_extraction(
    session: AsyncSession, run_id: int | None = None, post_ids: list[int] | None = None
) -> dict:
    """Extract entities for posts this stage has not seen yet.

    A post that yields zero entities is still marked analysed — otherwise it
    is re-processed on every run forever.
    """
    own_run = run_id is None
    if own_run:
        run_id = await _stage.open_run(session, "extraction")

    mode = "stub"  # updated below when the sidecar answered

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
        results, errors, failed, version = await _stage.analyse_texts(
            [t for _, t in pending], stub_ner, stage="ner"
        )
        mode = "laya-v1" if version == _stage.SIDECAR_VERSION else "stub"
        for (pid, _text), payload in zip(pending, results):
            if payload is None:
                continue
            entities, result_id = payload, None
            for ent in entities:
                # Sidecar entities can carry extra keys (e.g. co_occurrence pairs
                # add person_text/person_label/domain_text/domain_label) that the
                # Extraction table has no columns for. entity_text/entity_label
                # already carry the full "X + Y" summary, so drop the rest.
                clean_ent = {
                    k: v
                    for k, v in ent.items()
                    if k in ("entity_text", "entity_label", "start_pos", "end_pos", "confidence")
                }
                session.add(
                    Extraction(
                        post_id=pid,
                        run_id=run_id,
                        model_version=version,
                        aihub_result_id=result_id,
                        created_at=now,
                        **clean_ent,
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

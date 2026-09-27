"""Shared plumbing for the three analysis stages.

Two things live here because getting either wrong is expensive:

1. ``pending_posts`` — an anti-join on the per-stage marker column. The old
   "posts with no result row" query re-selected every post that legitimately
   produced zero rows, so half the corpus was re-analysed on every run. It
   also materialised every processed id into Python to build a giant ``NOT IN``.
2. ``analyse_texts`` — per-item error isolation, so one bad post cannot fail a
   whole run and a stage failure is still visible in the returned stats.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import PipelineRun, Post, Priority, RunKind, RunStatus, Sentiment

logger = logging.getLogger("analysis.stage")

STUB_VERSION = "stub-1"

# Maps sidecar label strings onto the DB enums (Laya trains on the same
# strings the stub rubric uses; kept here so the mapping has one home).
LABEL_ENUMS = {
    "priority": {
        "low": Priority.low,
        "medium": Priority.medium,
        "med": Priority.medium,
        "high": Priority.high,
    },
    "sentiment": {
        "pos": Sentiment.pos,
        "neu": Sentiment.neu,
        "neg": Sentiment.neg,
    },
}

MARKER = {
    "ner": Post.ner_model_version,
    "priority": Post.priority_model_version,
    "sentiment": Post.sentiment_model_version,
}
MARKER_NAME = {
    "ner": "ner_model_version",
    "priority": "priority_model_version",
    "sentiment": "sentiment_model_version",
}


async def pending_posts(
    session: AsyncSession, stage: str, limit: int | None = None
) -> list[tuple[int, str]]:
    """(post_id, body_text) for posts this stage has not analysed yet."""
    column = MARKER[stage]
    stmt = (
        select(Post.id, Post.body_text).where(column.is_(None)).order_by(Post.id)
    )
    limit = limit if limit is not None else get_settings().analysis_batch_size
    if limit:
        stmt = stmt.limit(limit)
    rows = await session.execute(stmt)
    return [(r[0], r[1] or "") for r in rows]


async def mark_analysed(
    session: AsyncSession, stage: str, post_ids: Sequence[int], model_version: str
) -> None:
    if not post_ids:
        return
    await session.execute(
        update(Post)
        .where(Post.id.in_(list(post_ids)))
        .values(**{MARKER_NAME[stage]: model_version})
    )


async def clear_markers(session: AsyncSession, post_ids: Sequence[int]) -> None:
    """Re-open a post for analysis (its body text changed)."""
    if not post_ids:
        return
    await session.execute(
        update(Post)
        .where(Post.id.in_(list(post_ids)))
        .values(
            ner_model_version=None,
            priority_model_version=None,
            sentiment_model_version=None,
        )
    )


# --- Sidecar client (pipeline-v3: real models) -------------------------------
# The inference sidecar (ml/pipeline/inference_server.py, host-run on
# 127.0.0.1:8101) serves the fine-tuned Laya classifier + GLiNER NER. When it
# is unreachable the stages transparently fall back to the deterministic stubs,
# so tests (no sidecar) and offline runs keep working unchanged.

SIDECAR_URL = os.environ.get(
    "ANALYSIS_SIDECAR_URL", "http://127.0.0.1:8101"
)
# Inside the worker/backend containers, 127.0.0.1 is the container itself.
# Docker's host-gateway (172.22.0.1 on the pinned app_default subnet) reaches
# the host-run sidecar. Set ANALYSIS_SIDECAR_URL per service in compose.
if "ANALYSIS_SIDECAR_URL" not in os.environ and os.path.exists("/.dockerenv"):
    SIDECAR_URL = "http://172.22.0.1:8101"
SIDECAR_VERSION = "laya-v1"

_http = httpx.AsyncClient(timeout=120.0)  # module-level; sidecar is local


async def _sidecar_post(path: str, texts: list[str]) -> list | None:
    """POST texts to the sidecar; None when unreachable/invalid (caller falls back)."""
    try:
        resp = await _http.post(f"{SIDECAR_URL}{path}", json={"texts": texts})
        resp.raise_for_status()
        return resp.json().get("results")
    except Exception:  # noqa: BLE001 — any sidecar failure means stub fallback
        logger.info("analysis sidecar unreachable at %s — falling back to stub", SIDECAR_URL)
        return None


async def analyse_texts(
    texts: list[str],
    stub: Callable[[str], Any],
    stage: str | None = None,
) -> tuple[list[Any], list[str], int, str]:
    """Analyze every text via the sidecar when available, else via the stub.

    Returns ``(results, errors, failed, model_version)``. A result of ``None``
    means that one item failed; a stage failure stays visible in the returned
    stats without failing the whole run. The model version reflects what
    actually produced the results (sidecar → ``laya-v1``, stub → ``stub-1``).
    """
    if stage in ("priority", "sentiment") and texts:
        results = await _sidecar_post("/classify", texts)
        if results is not None:
            out: list[Any] = []
            for r in results:
                if stage == "priority":
                    # (priority, confidence, result_id) — stub shape
                    out.append(
                        (
                            LABEL_ENUMS["priority"][r["priority"]],
                            float(r["priority_confidence"]),
                            None,
                        )
                    )
                else:
                    # (sentiment, intensity, confidence, result_id) — stub shape
                    s = r["sentiment"]
                    intensity = abs(float(r["sentiment_confidence"]) - 0.5) * 2.0
                    out.append(
                        (
                            LABEL_ENUMS["sentiment"][s],
                            round(intensity, 4),
                            float(r["sentiment_confidence"]),
                            None,
                        )
                    )
            return out, [], 0, SIDECAR_VERSION
    elif stage == "ner" and texts:
        results = await _sidecar_post("/extract", texts)
        if results is not None:
            return [ents for ents in results], [], 0, SIDECAR_VERSION

    # Stub fallback (deterministic; used by tests and when the sidecar is down)
    return [stub(t) for t in texts], [], 0, STUB_VERSION


async def open_run(session: AsyncSession, triggered_by: str) -> int:
    run = PipelineRun(
        kind=RunKind.analyze,
        status=RunStatus.running,
        started_at=datetime.now(timezone.utc),
        triggered_by=triggered_by,
    )
    session.add(run)
    await session.flush()
    return run.id


async def close_run(
    session: AsyncSession, run_id: int, stats: dict, triggered_by: str
) -> None:
    run = await session.get(PipelineRun, run_id)
    if run is None:
        return
    run.status = RunStatus.failed if stats.get("error") else RunStatus.done
    run.finished_at = datetime.now(timezone.utc)
    run.stats = stats
    run.triggered_by = triggered_by

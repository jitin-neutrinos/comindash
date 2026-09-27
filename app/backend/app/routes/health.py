"""GET /api/health — {status, db, scheduler, last_run per kind}.

The last-run lookups are cached for HEALTH_CACHE_S (default 30s): this endpoint
is polled by the compose healthcheck AND two frontend components, and the
audit (AUDIT-2026-09-24.md) measured ~16k queries per day from it uncached.
A forced refresh is available via ?refresh=1.
"""

from __future__ import annotations

import os
import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import PipelineRun, RunKind
from app.schemas import HealthOut, LastRunOut

router = APIRouter(prefix="/api", tags=["health"])

HEALTH_CACHE_S = float(os.environ.get("HEALTH_CACHE_S", "30"))


def _get_cache(request: Request) -> dict:
    """Per-app-instance cache: one app per process in prod, fresh app per
    test — never shares stale runs across instances."""
    cache = getattr(request.app.state, "_health_cache", None)
    if cache is None:
        cache = {"at": 0.0, "runs": None}
        request.app.state._health_cache = cache
    return cache


async def last_run_per_kind(session: AsyncSession) -> dict[str, LastRunOut]:
    out: dict[str, LastRunOut] = {}
    for kind in RunKind:
        row = await session.execute(
            select(PipelineRun)
            .where(PipelineRun.kind == kind)
            .order_by(PipelineRun.started_at.desc().nullslast(), PipelineRun.id.desc())
            .limit(1)
        )
        run = row.scalar_one_or_none()
        if run is not None:
            out[kind.value] = LastRunOut.model_validate(
                {
                    "kind": run.kind.value,
                    "status": run.status.value,
                    "started_at": run.started_at,
                    "finished_at": run.finished_at,
                    "error": run.error,
                }
            )
    return out


@router.get("/health", response_model=HealthOut)
async def health(
    request: Request,
    refresh: bool = False,
    session: AsyncSession = Depends(get_session),
) -> HealthOut:
    db = "ok"
    try:
        await session.execute(select(1))
    except Exception:  # noqa: BLE001
        db = "down"
    scheduler = getattr(request.app.state, "scheduler", None)
    scheduler_state = "running" if (scheduler and scheduler.running) else "disabled"
    cache = _get_cache(request)
    now = time.monotonic()
    if refresh or db != "ok" or now - cache["at"] > HEALTH_CACHE_S or cache["runs"] is None:
        cache["runs"] = await last_run_per_kind(session)
        cache["at"] = now
    runs = cache["runs"]
    status = "ok" if db == "ok" else "degraded"
    return HealthOut(status=status, db=db, scheduler=scheduler_state, last_run=runs)

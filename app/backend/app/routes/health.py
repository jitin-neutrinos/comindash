"""GET /api/health — {status, db, scheduler, last_run per kind}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import PipelineRun, RunKind
from app.schemas import HealthOut, LastRunOut

router = APIRouter(prefix="/api", tags=["health"])


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
    request: Request, session: AsyncSession = Depends(get_session)
) -> HealthOut:
    db = "ok"
    try:
        await session.execute(select(1))
    except Exception:  # noqa: BLE001
        db = "down"
    scheduler = getattr(request.app.state, "scheduler", None)
    scheduler_state = "running" if (scheduler and scheduler.running) else "disabled"
    runs = await last_run_per_kind(session)
    status = "ok" if db == "ok" else "degraded"
    return HealthOut(status=status, db=db, scheduler=scheduler_state, last_run=runs)

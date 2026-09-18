"""GET /api/runs — pipeline run history."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import PipelineRun, RunKind
from app.schemas import PaginatedOut, RunOut

router = APIRouter(prefix="/api", tags=["pipeline"])


@router.get("/runs", response_model=PaginatedOut)
async def list_runs(
    kind: str | None = Query(None, description="ingest|analyze|assistant"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> PaginatedOut:
    stmt = select(PipelineRun)
    if kind:
        try:
            stmt = stmt.where(PipelineRun.kind == RunKind(kind))
        except ValueError:
            from fastapi import HTTPException

            raise HTTPException(status_code=422, detail=f"unknown kind: {kind}")

    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (
        (
            await session.execute(
                stmt.order_by(
                    PipelineRun.started_at.desc().nullslast(), PipelineRun.id.desc()
                )
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )

    items = [
        RunOut.model_validate(
            {
                "id": r.id,
                "kind": r.kind.value,
                "status": r.status.value,
                "started_at": r.started_at,
                "finished_at": r.finished_at,
                "stats": r.stats or {},
                "error": r.error,
                "triggered_by": r.triggered_by,
            }
        )
        for r in rows
    ]
    return PaginatedOut(items=items, total=total, limit=limit, offset=offset)

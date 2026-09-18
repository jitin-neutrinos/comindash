import json
import os
from datetime import datetime, timezone
from typing import Any
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_session
from app.models import PipelineRun, Job, AuditLog, ModelKind, ModelVersion
from app.schemas import ModelVersionIn, ModelVersionOut

router = APIRouter(prefix="/api/admin", tags=["admin"])

LOKI_URL = os.environ.get("LOKI_URL", "http://loki:3100")

@router.get("/logs")
async def get_logs(
    service: str | None = None,
    level: str | None = None,
    run_id: str | None = None,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
):
    query_parts = ['container=~".+"']
    if service:
        query_parts.append(f'service="{service}"')
    if level:
        query_parts.append(f'level="{level.lower()}"')
    if run_id:
        query_parts.append(f'run_id="{run_id}"')
    
    query = "{" + ",".join(query_parts) + "}"

    
    # Sampled audit log
    try:
        session.add(AuditLog(actor="local-admin", action="view_logs", detail={"query": query}))
        await session.commit()
    except Exception as e:
        import sys; sys.stderr.write('AUDIT ERROR: ' + repr(e) + '\n'); sys.stderr.flush()
    
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{LOKI_URL}/loki/api/v1/query_range", params={"query": query, "limit": limit})
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for result in data.get("data", {}).get("result", []):
                    for val in result.get("values", []):
                        try:
                            # val is [timestamp, log_line]
                            log_obj = json.loads(val[1])
                            results.append(log_obj)
                        except json.JSONDecodeError:
                            results.append({"_raw": val[1]})
                return {"items": results}
    except Exception as e:
        import sys; sys.stderr.write('AUDIT ERROR: ' + repr(e) + '\n'); sys.stderr.flush()
        pass
    
    # Fallback to jsonl files if Loki is unreachable
    results = []
    try:
        if service:
            files = [f"/app/logs/{service}.jsonl"]
        else:
            files = ["/app/logs/backend.jsonl", "/app/logs/worker.jsonl"]
            
        for f in files:
            if os.path.exists(f):
                with open(f, 'r') as file:
                    for line in file:
                        try:
                            log_obj = json.loads(line)
                            if level and log_obj.get("level", "").lower() != level.lower():
                                continue
                            if run_id and str(log_obj.get("run_id")) != run_id:
                                continue
                            results.append(log_obj)
                        except json.JSONDecodeError:
                            continue
        results.sort(key=lambda x: x.get("timestamp", x.get("ts", "")), reverse=True)
        return {"items": results[:limit], "source": "fallback_file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pipeline")
async def get_pipeline_runs(session: AsyncSession = Depends(get_session), limit: int = 50):
    rows = await session.execute(select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(limit))
    runs = rows.scalars().all()
    return {"items": runs}

@router.get("/audit")
async def get_audit_logs(session: AsyncSession = Depends(get_session), limit: int = 50):
    rows = await session.execute(select(AuditLog).order_by(AuditLog.ts.desc()).limit(limit))
    return {"items": rows.scalars().all()}

PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")

@router.get("/metrics/query")
async def query_prometheus(query: str, session: AsyncSession = Depends(get_session)):
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": query})
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/metrics/query_range")
async def query_range_prometheus(query: str, start: str, end: str, step: str, session: AsyncSession = Depends(get_session)):
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{PROMETHEUS_URL}/api/v1/query_range", params={
                "query": query, "start": start, "end": end, "step": step
            })
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Model registry (WP2) ----------------------------------------------------
# No AI Hub API trains/deploys/validates a model (docs/go-live-checklist.md),
# so this is a manual write path: record the version + Batch-validation
# metrics a human reads off the AI Hub UI after Step 3 of that checklist.


@router.get("/model-versions", response_model=list[ModelVersionOut])
async def list_model_versions(
    kind: str | None = None, session: AsyncSession = Depends(get_session)
):
    stmt = select(ModelVersion).order_by(
        ModelVersion.kind, ModelVersion.trained_at.desc().nullslast()
    )
    if kind:
        stmt = stmt.where(ModelVersion.kind == kind)
    rows = await session.execute(stmt)
    return rows.scalars().all()


@router.post("/model-versions", response_model=ModelVersionOut)
async def upsert_model_version(
    body: ModelVersionIn, session: AsyncSession = Depends(get_session)
):
    try:
        kind = ModelKind(body.kind)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"kind must be one of {[k.value for k in ModelKind]}, got {body.kind!r}",
        )

    existing = await session.scalar(
        select(ModelVersion).where(
            ModelVersion.kind == kind, ModelVersion.version == body.version
        )
    )
    row = existing or ModelVersion(kind=kind, version=body.version)
    row.ai_hub_model_id = body.ai_hub_model_id
    row.metrics = body.metrics
    row.active = body.active
    row.trained_at = body.trained_at or datetime.now(timezone.utc)
    row.training_set_ref = body.training_set_ref
    session.add(row)
    await session.flush()

    if body.active:
        # one active version per kind — the dashboard's future "provisional"
        # label reads this flag, so only the version just recorded should win.
        others = (
            await session.execute(
                select(ModelVersion).where(
                    ModelVersion.kind == kind, ModelVersion.id != row.id
                )
            )
        ).scalars().all()
        for other in others:
            other.active = False

    await session.commit()
    await session.refresh(row)
    return row

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

# --- Ops config + overview (production hardening 2026-09-28) -----------------
# Runtime-operable settings live in the app_config table so the Settings page
# can change them without a container rebuild. The sidecar pulls its idle
# window from /api/admin/ops/config on every idle-check tick.
from app.models import AppConfig  # noqa: E402

OPS_KEY = "ops"

DEFAULT_OPS = {
    # sidecar GPU economy
    "idle_unload_s": 900,          # sidecar exits after this many idle seconds
    "idle_unload_enabled": True,
    # retention (days) — mirrors services/retention.py defaults
    "job_done_retention_days": 14,
    "run_retention_days": 90,
    "audit_retention_days": 180,
    # alerts
    "alert_dead_jobs": True,
    "alert_storage_pct": 85,
}


async def _load_ops(session: AsyncSession) -> dict:
    row = await session.get(AppConfig, OPS_KEY)
    cfg = dict(DEFAULT_OPS)
    if row is not None and isinstance(row.value, dict):
        cfg.update({k: v for k, v in row.value.items() if k in DEFAULT_OPS})
    return cfg


def _public_ops(cfg: dict) -> dict:
    return {k: v for k, v in cfg.items()}


@router.get("/ops/config")
async def get_ops_config(session: AsyncSession = Depends(get_session)):
    cfg = await _load_ops(session)
    return _public_ops(cfg)


@router.post("/ops/config")
async def set_ops_config(
    payload: dict, session: AsyncSession = Depends(get_session)
):
    """Persist runtime ops settings. Unknown keys are rejected (422) so a
    typo'd frontend field can never silently no-op."""
    unknown = [k for k in payload if k not in DEFAULT_OPS]
    if unknown:
        raise HTTPException(422, f"unknown ops keys: {', '.join(unknown)}")
    cfg = await _load_ops(session)
    cfg.update(payload)
    row = await session.get(AppConfig, OPS_KEY)
    if row is None:
        row = AppConfig(key=OPS_KEY, value=cfg, updated_at=datetime.now(timezone.utc))
        session.add(row)
    else:
        row.value = cfg
        row.updated_at = datetime.now(timezone.utc)
    session.add(AuditLog(
        actor="local-admin", action="ops_config_update",
        detail={"changed": payload},
    ))
    await session.commit()
    return _public_ops(cfg)


@router.get("/ops/overview")
async def ops_overview(session: AsyncSession = Depends(get_session)):
    """One call for the Admin ops panel + Settings page: queue health, worker
    state, sidecar GPU stats, storage, retention policy, recent failures."""
    import httpx as _hx
    from app.services.retention import storage_status
    from app.services.system_status import worker_state, age_seconds, success_rate
    from sqlalchemy import func as _f

    now = datetime.now(timezone.utc)
    out: dict[str, Any] = {}

    # queue
    rows = (await session.execute(
        select(Job.kind, Job.status, _f.count()).group_by(Job.kind, Job.status)
    )).all()
    queue: dict[str, dict[str, int]] = {}
    for kind, status, count in rows:
        k = kind.value if hasattr(kind, "value") else str(kind)
        s = status.value if hasattr(status, "value") else str(status)
        queue.setdefault(k, {})[s] = count
    pending = sum(v.get("pending", 0) for v in queue.values())
    running = sum(v.get("running", 0) for v in queue.values())
    dead = sum(v.get("dead", 0) for v in queue.values())
    last_lock = await session.scalar(select(_f.max(Job.locked_at)))
    wstate, wreason = worker_state(age_seconds(last_lock, now), pending, running)
    out["queue"] = {
        "by_kind": queue, "pending": pending, "running": running, "dead": dead,
        "worker_state": wstate, "worker_reason": wreason,
        "last_activity": last_lock,
    }

    # dead jobs detail (top 10, for the failures panel)
    dead_rows = (await session.execute(
        select(Job.id, Job.kind, Job.attempts, Job.error, Job.locked_at)
        .where(Job.status == "dead").order_by(Job.id.desc()).limit(10)
    )).all()
    out["dead_jobs"] = [
        {"id": r[0], "kind": str(r[1]), "attempts": r[2],
         "error": (r[3] or "")[:300], "last_try": r[4]}
        for r in dead_rows
    ]

    # sidecar GPU stats (host-run; probe directly)
    sidecar_url = os.environ.get("ANALYSIS_SIDECAR_URL", "http://172.22.0.1:8101")
    sidecar: dict[str, Any] = {"reachable": False}
    try:
        async with _hx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{sidecar_url}/stats")
            if r.status_code == 200:
                sidecar = {"reachable": True, **r.json()}
    except Exception:  # noqa: BLE001 — probe must never fail the panel
        pass
    out["sidecar"] = sidecar

    # storage + retention policy + prometheus rates
    out["storage"] = storage_status()
    cfg = await _load_ops(session)
    out["retention_policy"] = {
        "job_done_retention_days": cfg["job_done_retention_days"],
        "run_retention_days": cfg["run_retention_days"],
        "audit_retention_days": cfg["audit_retention_days"],
    }
    out["alerts_enabled"] = {
        "dead_jobs": cfg["alert_dead_jobs"],
        "storage_pct": cfg["alert_storage_pct"],
    }

    # prometheus: 24h job throughput + error rate (empty if prom down)
    prom: dict[str, Any] = {}
    try:
        async with _hx.AsyncClient(timeout=2.0) as c:
            for name, q in [
                ("jobs_done_24h", 'sum(increase(jobs_processed_total{status="done"}[24h]))'),
                ("jobs_failed_24h", 'sum(increase(jobs_processed_total{status="failed"}[24h]))'),
                ("job_retries_24h", "sum(increase(job_retry_total[24h]))"),
            ]:
                r = await c.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": q})
                data = r.json().get("data", {}).get("result", [])
                prom[name] = float(data[0]["value"][1]) if data else None
    except Exception:  # noqa: BLE001
        pass
    out["prometheus_24h"] = prom
    return out


@router.post("/ops/maintenance/run")
async def trigger_maintenance(session: AsyncSession = Depends(get_session)):
    """Queue a maintenance pass right now (Settings page button)."""
    from app.services import jobs as jobs_svc
    job = await jobs_svc.enqueue(session, "maintenance", {"triggered_by": "manual:settings"})
    session.add(AuditLog(actor="local-admin", action="maintenance_triggered", detail={}))
    await session.commit()
    return {"queued": job is not None, "job_id": job.id if job else None}

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

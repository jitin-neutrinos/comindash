"""FastAPI app factory, lifespan, routers."""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from prometheus_fastapi_instrumentator import Instrumentator

from app.config import get_settings
from app.database import get_engine
from app.logging_config import setup_logging
from app.routes import ALL_ROUTERS

logger = structlog.get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    scheduler = None

    # startup reconciliation: requeue jobs stuck in `running` by a dead worker
    try:
        from app.database import get_sessionmaker
        from app.services.jobs import watchdog

        async with get_sessionmaker()() as session:
            requeued = await watchdog(session)
            if requeued:
                logger.info("startup reconciliation requeued %d stale jobs", requeued)
    except Exception as e:  # noqa: BLE001 — DB may not be up yet; not fatal
        logger.warning("startup reconciliation skipped: %s", e)

    if settings.scheduler_enabled and app.state._start_scheduler:
        from app.services.scheduler import create_scheduler

        scheduler = create_scheduler()
        scheduler.start()
        logger.info(
            "scheduler started (ingest every %d min, assistant cycle at %02d:00 UTC)",
            settings.ingest_interval_minutes,
            settings.assistant_cycle_hour,
        )
    app.state.scheduler = scheduler

    yield

    if scheduler is not None and scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("scheduler stopped")
    await get_engine().dispose()
    logger.info("engine disposed")


def create_app(start_scheduler: bool | None = None) -> FastAPI:
    """Build the API app. ``start_scheduler`` overrides SCHEDULER_ENABLED
    (tests pass False)."""
    setup_logging("backend")
    app = FastAPI(
        title="Neutrinos Community Insights API",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.state._start_scheduler = (
        get_settings().scheduler_enabled if start_scheduler is None else start_scheduler
    )
    for router in ALL_ROUTERS:
        app.include_router(router)
    Instrumentator().instrument(app).expose(app)

    @app.middleware("http")
    async def logging_middleware(request: Request, call_next):
        request_id = str(uuid.uuid4())
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        
        start_time = time.time()
        
        try:
            response = await call_next(request)
            duration_ms = round((time.time() - start_time) * 1000, 2)
            logger.info("http_request", method=request.method, path=request.url.path, status=response.status_code, duration_ms=duration_ms)
            response.headers["X-Request-ID"] = request_id
            return response
        except Exception as e:
            duration_ms = round((time.time() - start_time) * 1000, 2)
            logger.error("http_request_error", method=request.method, path=request.url.path, status=500, duration_ms=duration_ms, error=str(e))
            raise


    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"service": "community-insights", "docs": "/docs"}

    return app


app = create_app()

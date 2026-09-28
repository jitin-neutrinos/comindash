"""GET /api/review — the AI model registry, as recorded and as behaving.
GET /api/system  — command-centre status for the admin page.

Both are read-only assemblies over the DB; the logic (and its self-checks) live
in services/model_review.py and services/system_status.py so they can be
exercised without an HTTP stack.
"""

from __future__ import annotations

import os
import time

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services.model_review import build_review
from app.services.system_status import build_status

router = APIRouter(prefix="/api", tags=["review"])

# The command centre polls; each build_status() costs ~20 queries plus three
# service probes. Cached per app instance, same pattern as /api/health.
STATUS_CACHE_S = float(os.environ.get("STATUS_CACHE_S", "10"))
REVIEW_CACHE_S = float(os.environ.get("REVIEW_CACHE_S", "60"))


def _cache(request: Request, name: str) -> dict:
    attr = f"_{name}_cache"
    c = getattr(request.app.state, attr, None)
    if c is None:
        c = {"at": 0.0, "data": None, "key": None}
        setattr(request.app.state, attr, c)
    return c


@router.get("/review")
async def review(
    request: Request,
    days: int = Query(30, ge=1, le=365),
    refresh: bool = False,
    session: AsyncSession = Depends(get_session),
):
    c = _cache(request, "review")
    now = time.monotonic()
    if refresh or c["data"] is None or c["key"] != days or now - c["at"] > REVIEW_CACHE_S:
        c["data"] = await build_review(session, days=days)
        c["at"] = now
        c["key"] = days
    return c["data"]


@router.get("/system")
async def system(
    request: Request,
    refresh: bool = False,
    session: AsyncSession = Depends(get_session),
):
    c = _cache(request, "system")
    now = time.monotonic()
    if refresh or c["data"] is None or now - c["at"] > STATUS_CACHE_S:
        c["data"] = await build_status(session)
        c["at"] = now
    return c["data"]

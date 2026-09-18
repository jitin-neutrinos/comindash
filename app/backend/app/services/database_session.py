"""Session helper for services invoked outside a request (worker/scheduler):
opens a fresh session from the shared engine."""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_sessionmaker


@asynccontextmanager
async def get_run_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session

"""Deterministic test fixtures: env scrub + SQLite async engine + app client.

The env scrub runs at import time (before any app import in test modules) so
stub mode is guaranteed even on a developer machine with real tokens in env
or a backend/.env file: empty-string env vars shadow .env values in
pydantic-settings, and the settings cache is cleared afterwards.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# --- force stub mode + deterministic gate token -----------------------------
for _var in (
    "AIHUB_TOKEN_NER",
    "AIHUB_TOKEN_PRIORITY",
    "AIHUB_TOKEN_SENTIMENT",
    "AIHUB_ASSISTANT_TOKEN",
    "AIHUB_NER_DEPLOYMENT_ID",
    "AIHUB_PRIORITY_DEPLOYMENT_ID",
    "AIHUB_SENTIMENT_DEPLOYMENT_ID",
    "AIHUB_ASSISTANT_ID",
    "AIHUB_KNOWLEDGE_SOURCE_IDS",
    "DISCOURSE_API_KEY",
):
    os.environ[_var] = ""
os.environ["INGEST_TOKEN"] = "test-ingest-token"
os.environ["SCHEDULER_ENABLED"] = "false"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import get_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Base  # noqa: E402

get_settings.cache_clear()

INGEST_TOKEN = "test-ingest-token"


@pytest.fixture
async def engine():
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
async def session(session_factory):
    async with session_factory() as s:
        yield s


@pytest.fixture
async def app(session_factory):
    application = create_app(start_scheduler=False)

    async def _override():
        async with session_factory() as s:
            yield s

    application.dependency_overrides[get_session] = _override
    return application


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c

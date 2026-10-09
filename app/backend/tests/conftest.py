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

# --- force deterministic gate token + keyless Discourse mode ----------------
os.environ["DISCOURSE_API_KEY"] = ""
os.environ["INGEST_TOKEN"] = "test-ingest-token"
os.environ["SCHEDULER_ENABLED"] = "false"
# Dashboard auth is configured in tests so the gate is exercised for real;
# the default `client` fixture carries a valid session cookie, and
# `anon_client` (no cookie) drives the auth tests.
os.environ["DASHBOARD_PASSWORD"] = "test-password"
os.environ["DASHBOARD_SESSION_SECRET"] = "test-session-secret"
# Tests assert stub-mode behaviour: point the analysis sidecar at a dead port
# so every analyse_texts call exercises the stub path instead of a real
# running sidecar (SIDECAR_URL is read at import time by _stage).
# Fast-fail the cold-start retries too: tests never want to sleep through the
# socket-activation retry loop.
os.environ["ANALYSIS_SIDECAR_URL"] = "http://127.0.0.1:1"
os.environ["SIDECAR_CONNECT_RETRIES"] = "1"
os.environ["SIDECAR_RETRY_DELAY_S"] = "0.1"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.database import get_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services import auth  # noqa: E402

get_settings.cache_clear()
auth.reset_cache()

INGEST_TOKEN = "test-ingest-token"
TEST_PASSWORD = "test-password"


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


@pytest.fixture(autouse=True)
def _reset_login_lockouts():
    """The lockout state is process-global; a test that trips it (login lockout)
    must not leak into the next test's login. Reset around every test."""
    auth._ATTEMPTS.clear()
    yield
    auth._ATTEMPTS.clear()


@pytest.fixture
async def anon_client(app):
    """No session cookie — used by the auth tests to prove the gate closes."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test"
    ) as c:
        yield c


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test"
    ) as c:
        # Authenticate through the real endpoint so the cookie the app sets is
        # the cookie it later verifies (no hand-rolled token in the fixture).
        r = await c.post("/api/auth/login", json={"password": TEST_PASSWORD})
        assert r.status_code == 200, r.text
        yield c

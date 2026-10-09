"""Dashboard auth: gate enforcement, login/logout, lockout.

Uses the real endpoints and the real cookie the app sets — no shortcuts, so a
regression in cookie attributes or the middleware fails these tests.
"""

from __future__ import annotations

import pytest

from app.services import auth

pytestmark = pytest.mark.asyncio


async def test_protected_route_requires_auth(anon_client):
    r = await anon_client.get("/api/overview")
    assert r.status_code == 401


async def test_health_is_public(anon_client):
    # The container healthcheck has no cookie; health must stay open.
    r = await anon_client.get("/api/health")
    assert r.status_code == 200


async def test_login_rejects_wrong_password(anon_client):
    r = await anon_client.post("/api/auth/login", json={"password": "nope"})
    assert r.status_code == 401


async def test_login_then_access(anon_client):
    r = await anon_client.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 200
    assert auth.COOKIE_NAME in r.cookies or r.cookies.get(auth.COOKIE_NAME)
    # cookie is now on the client
    ok = await anon_client.get("/api/overview")
    assert ok.status_code == 200


async def test_cookie_is_hardened(anon_client):
    r = await anon_client.post("/api/auth/login", json={"password": "test-password"})
    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "httponly" in set_cookie
    assert "secure" in set_cookie
    assert "samesite=strict" in set_cookie


async def test_logout_clears_session(anon_client):
    await anon_client.post("/api/auth/login", json={"password": "test-password"})
    assert (await anon_client.get("/api/overview")).status_code == 200
    await anon_client.post("/api/auth/logout")
    # after logout the cookie is gone -> 401
    assert (await anon_client.get("/api/overview")).status_code == 401


async def test_status_reports_configured(anon_client):
    r = await anon_client.get("/api/auth/status")
    body = r.json()
    assert body["configured"] is True
    assert body["authenticated"] is False


async def test_token_tamper_rejected():
    t = auth.issue_token()
    assert auth.verify_token(t) is True
    assert auth.verify_token(t[:-3] + "aaa") is False
    assert auth.verify_token("garbage") is False
    assert auth.verify_token(None) is False


async def test_expired_token_rejected():
    assert auth.verify_token(auth.issue_token(ttl_seconds=-5)) is False


async def test_lockout_after_max_attempts(anon_client):
    # config default: 10 attempts then locked
    for _ in range(10):
        await anon_client.post("/api/auth/login", json={"password": "bad"})
    r = await anon_client.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 429

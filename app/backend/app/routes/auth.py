"""Auth endpoints + the gate that protects every other /api route.

* ``POST /api/auth/login``  {password} -> sets an HttpOnly session cookie
* ``POST /api/auth/logout`` -> clears it
* ``GET  /api/auth/status`` -> {configured, authenticated}

Protection is a single middleware (see ``install_auth_middleware``) so a new
route is private by default — opt-outs are explicit and few. The health
endpoint stays public because the container healthcheck has no cookie; the auth
endpoints themselves and CORS preflights are the only other exemptions.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import get_settings
from app.services import auth

logger = logging.getLogger("auth.routes")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Paths reachable without a session. Health must stay open for the compose
# healthcheck; everything under /api/auth is the login flow itself.
PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/status"}


class LoginBody(BaseModel):
    password: str


def _client_ip(request: Request) -> str:
    # Behind the Cloudflare tunnel + nginx the real client is in
    # CF-Connecting-IP; fall back to the socket peer.
    return (
        request.headers.get("cf-connecting-ip")
        or (request.headers.get("x-forwarded-for", "").split(",")[0].strip())
        or (request.client.host if request.client else "unknown")
    )


@router.get("/status")
async def status(request: Request) -> dict:
    s = get_settings()
    return {
        "configured": auth.auth_configured(),
        "authenticated": auth.verify_token(request.cookies.get(auth.COOKIE_NAME)),
        "idle_minutes": s.dashboard_idle_minutes,
        "session_ttl_hours": s.dashboard_session_ttl_hours,
    }


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response) -> JSONResponse:
    if not auth.auth_configured():
        # Fail closed: no password configured => nobody logs in.
        return JSONResponse({"detail": "Authentication is not configured"}, status_code=503)

    ip = _client_ip(request)
    locked, remaining = auth.is_locked(ip)
    if locked:
        logger.warning("login locked out for %s (%ds remaining)", ip, remaining)
        return JSONResponse(
            {"detail": f"Too many attempts. Try again in {remaining}s."},
            status_code=429,
        )

    if not auth.verify_password(body.password):
        auth.record_failure(ip)
        logger.warning("failed login from %s", ip)
        return JSONResponse({"detail": "Incorrect password"}, status_code=401)

    auth.clear_failures(ip)
    token = auth.issue_token()
    s = get_settings()
    resp = JSONResponse({"ok": True, "ttl_hours": s.dashboard_session_ttl_hours})
    resp.set_cookie(
        auth.COOKIE_NAME,
        token,
        max_age=s.dashboard_session_ttl_hours * 3600,
        httponly=True,          # not readable from JS — blocks XSS cookie theft
        secure=True,            # HTTPS-only (tunnel terminates TLS)
        samesite="strict",      # no cross-site sends — CSRF defense
        path="/",
    )
    logger.info("login ok from %s", ip)
    return resp


@router.post("/logout")
async def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return resp


def install_auth_middleware(app) -> None:
    """Gate all /api/* except PUBLIC_PATHS behind a valid session cookie."""

    @app.middleware("http")
    async def auth_gate(request: Request, call_next):
        path = request.url.path
        if (
            not path.startswith("/api")
            or path in PUBLIC_PATHS
            or request.method == "OPTIONS"
        ):
            return await call_next(request)
        if auth.verify_token(request.cookies.get(auth.COOKIE_NAME)):
            return await call_next(request)
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)

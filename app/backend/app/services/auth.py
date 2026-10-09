"""Dashboard authentication: Argon2id password hashing + signed session cookies.

Design notes (why this shape):

* **Hashing**: Argon2id via argon2-cffi, OWASP's first choice for new
  applications (memory-hard, GPU/ASIC-resistant). Defaults are already the
  OWASP-recommended profile (m=64 MiB, t=3, p=4). The plaintext password is
  hashed ONCE at boot and only the hash is kept in memory — the plaintext is
  never stored, logged, or compared with ``==``.
* **Constant-time**: verification is delegated to argon2's ``verify`` (constant
  time); the HMAC check uses ``hmac.compare_digest``.
* **Sessions**: stateless, HMAC-SHA256-signed tokens (stdlib only) — no session
  table, and they survive a container restart because the signing key lives in
  ``DASHBOARD_SESSION_SECRET``. A token carries only an expiry; possession of a
  validly-signed, unexpired token is the credential.
* **Brute force**: per-IP attempt counter with a lockout window (in-memory; one
  backend process in prod, so this is sufficient and needs no shared store).
* **Fail closed**: if no password is configured, login is refused outright — an
  unconfigured deployment must never be an open one.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.config import get_settings

logger = logging.getLogger("auth")

# OWASP-recommended Argon2id profile (argon2-cffi defaults == this).
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)

COOKIE_NAME = "comindash_session"


# --- password ----------------------------------------------------------------

def _configured_hash() -> str:
    """The Argon2id hash to verify against: a pre-hashed value if provided,
    else the plaintext from env hashed in memory at first use."""
    s = get_settings()
    if s.dashboard_password_hash:
        return s.dashboard_password_hash
    if s.dashboard_password:
        return _hasher.hash(s.dashboard_password)
    return ""


_HASH_CACHE: str | None = None


def _get_hash() -> str:
    global _HASH_CACHE
    if _HASH_CACHE is None:
        _HASH_CACHE = _configured_hash()
        if _HASH_CACHE:
            logger.info("dashboard auth enabled (argon2id)")
        else:
            logger.warning("dashboard auth: NO PASSWORD CONFIGURED — login disabled (fail closed)")
    return _HASH_CACHE


def reset_cache() -> None:
    """Tests only: forget the cached hash so a changed setting takes effect."""
    global _HASH_CACHE
    _HASH_CACHE = None


def verify_password(candidate: str) -> bool:
    """Constant-time Argon2id verification. False when auth is unconfigured."""
    stored = _get_hash()
    if not stored:
        return False
    try:
        return _hasher.verify(stored, candidate)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:  # noqa: BLE001 — never leak a hashing error as a 500
        return False


def auth_configured() -> bool:
    return bool(_get_hash())


# --- session tokens ----------------------------------------------------------

def _secret() -> bytes:
    s = get_settings()
    key = s.dashboard_session_secret or s.ingest_token or "insecure-dev-secret"
    return key.encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(txt: str) -> bytes:
    return base64.urlsafe_b64decode(txt + "=" * (-len(txt) % 4))


def issue_token(ttl_seconds: int | None = None) -> str:
    s = get_settings()
    ttl = ttl_seconds if ttl_seconds is not None else s.dashboard_session_ttl_hours * 3600
    payload = json.dumps({"exp": int(time.time()) + ttl}).encode("utf-8")
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return f"{_b64e(payload)}.{_b64e(sig)}"


def verify_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    try:
        p_b64, s_b64 = token.split(".", 1)
        payload = _b64d(p_b64)
        sig = _b64d(s_b64)
    except Exception:  # noqa: BLE001
        return False
    expected = hmac.new(_secret(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        return int(json.loads(payload)["exp"]) > int(time.time())
    except Exception:  # noqa: BLE001
        return False


def new_csrf_nonce() -> str:
    """Reserved for future double-submit CSRF if the API ever accepts
    cross-site state changes; unused while SameSite=Strict is in force."""
    return secrets.token_urlsafe(16)


# --- brute-force lockout -----------------------------------------------------

_ATTEMPTS: dict[str, list[float]] = {}


def is_locked(ip: str) -> tuple[bool, int]:
    """(locked, seconds_remaining) for this IP."""
    s = get_settings()
    window = s.login_lockout_minutes * 60
    now = time.time()
    hits = [t for t in _ATTEMPTS.get(ip, []) if now - t < window]
    _ATTEMPTS[ip] = hits
    if len(hits) >= s.login_max_attempts:
        return True, int(window - (now - hits[0])) + 1
    return False, 0


def record_failure(ip: str) -> None:
    _ATTEMPTS.setdefault(ip, []).append(time.time())


def clear_failures(ip: str) -> None:
    _ATTEMPTS.pop(ip, None)

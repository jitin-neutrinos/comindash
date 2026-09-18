#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# validate.sh — full-app validation harness for the Community Insights Dashboard
#
# Steps:
#   1. Create a dedicated venv at app/.venv-validate (idempotent)
#   2. Install backend/requirements.txt + worker/requirements.txt
#   3. Run backend selfcheck (backend/app/selfcheck.py) if present
#   4. Run pytest backend/tests -q
#   5. Worker smoke check (boot, connect-or-skip DB, exit 0)
#
# Prints clear [SKIP]/[ OK ]/[FAIL] lines. Exit code is non-zero only on real
# failures (a FAIL step, or FAIL/ERROR pytest outcome). Skipped pieces never
# fail the run on their own.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."   # app root

APP_ROOT="$(pwd)"
VENV="$APP_ROOT/.venv-validate"
PIP="$VENV/bin/pip"
PY="$VENV/bin/python"

PASS=0; FAIL=0
ok()   { echo "[ OK ] $*"; PASS=$((PASS+1)); }
skip() { echo "[SKIP] $*"; }
fail() { echo "[FAIL] $*"; FAIL=$((FAIL+1)); }

echo "=== Community Insights Dashboard :: validation harness ==="
echo "app root: $APP_ROOT"

# --- 1. venv ----------------------------------------------------------------
echo "--- step 1/5: venv"
# Spec targets Python 3.12; prefer a 3.12/3.13 interpreter (pinned wheels like
# pydantic-core may not exist for very new system Pythons, e.g. 3.14).
PYBIN="${PYTHON:-}"
if [ -z "$PYBIN" ]; then
    for CAND in python3.12 python3.13 python3; do
        if command -v "$CAND" > /dev/null 2>&1; then PYBIN="$CAND"; break; fi
    done
fi
echo "using interpreter: ${PYBIN:-none found}"
if [ -x "$PY" ] && "$PY" -c 'import sys; sys.exit(0 if sys.version_info < (3, 14) else 1)'; then
    ok "venv already exists at .venv-validate ($("$PY" --version))"
else
    if [ -x "$PY" ]; then
        skip "existing .venv-validate uses a too-new Python; recreating"
        rm -rf "$VENV"
    fi
    if "$PYBIN" -m venv "$VENV" 2> >(grep -v 'ensurepip' >&2); then
        ok "created venv at .venv-validate"
    else
        # Some distros need python3-venv installed; try without pip bootstrap.
        if "$PYBIN" -m venv --without-pip "$VENV" && "$VENV/bin/python" -m ensurepip --upgrade >/dev/null 2>&1; then
            ok "created venv at .venv-validate (without-pip + ensurepip fallback)"
        else
            fail "could not create venv at .venv-validate (is python3-venv installed?)"
            echo "SUMMARY: pass=$PASS fail=$FAIL"; exit 1
        fi
    fi
fi

# --- 2. pip installs ----------------------------------------------------------
echo "--- step 2/5: pip install"
INSTALLED_ANY=0
for REQ in backend/requirements.txt worker/requirements.txt; do
    if [ -f "$REQ" ]; then
        echo "installing $REQ ..."
        if "$PIP" install -q -r "$REQ"; then
            ok "installed $REQ"
            INSTALLED_ANY=1
        else
            fail "pip install -r $REQ"
        fi
    else
        skip "$REQ not present yet (component still landing)"
    fi
done
if [ "$INSTALLED_ANY" -eq 0 ]; then
    fail "no requirements files found to install"
fi

# --- 3. backend selfcheck ------------------------------------------------------
echo "--- step 3/5: backend selfcheck"
SELFCHECK="$APP_ROOT/backend/app/selfcheck.py"
if [ -f "$SELFCHECK" ]; then
    if (cd "$APP_ROOT/backend" && "$PY" app/selfcheck.py); then
        ok "backend selfcheck passed"
    else
        fail "backend selfcheck failed (rc=$?)"
    fi
else
    skip "backend/app/selfcheck.py not present yet"
fi

# --- 4. pytest backend/tests ----------------------------------------------------
echo "--- step 4/5: pytest backend/tests"
if [ ! -d "$APP_ROOT/backend/tests" ] || [ -z "$(find "$APP_ROOT/backend/tests" -name 'test_*.py' -print -quit 2>/dev/null)" ]; then
    skip "backend/tests has no tests yet"
elif ! "$PY" -c 'import pytest' 2>/dev/null; then
    skip "pytest not installed (add to backend requirements or install manually)"
else
    echo "running pytest backend/tests -q ..."
    PYTEST_OUT="$(mktemp)"
    (cd "$APP_ROOT/backend" && "$PY" -m pytest tests -q) > "$PYTEST_OUT" 2>&1
    RC=$?
    tail -n 15 "$PYTEST_OUT"
    if [ $RC -eq 0 ]; then
        ok "pytest backend/tests passed"
    elif grep -qE '^ERROR|error' "$PYTEST_OUT" && ! grep -qE '[0-9]+ (passed|failed)' "$PYTEST_OUT"; then
        fail "pytest could not run (collection/import error, rc=$RC)"
    else
        fail "pytest backend/tests failed (rc=$RC)"
    fi
    rm -f "$PYTEST_OUT"
fi

# --- 5. worker smoke check --------------------------------------------------------
echo "--- step 5/5: worker smoke check"
if [ ! -f "$APP_ROOT/worker/worker.py" ]; then
    fail "worker/worker.py missing"
elif ! "$PY" -c 'import asyncpg' 2>/dev/null; then
    fail "asyncpg not importable — worker requirements install failed?"
else
    echo "running worker --smoke (connect-or-skip DB) ..."
    if (cd "$APP_ROOT/worker" && DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://insights:insights_local@localhost:5433/insights}" \
        WORKER_HEARTBEAT_PATH="$(mktemp -u)" "$PY" worker.py --smoke); then
        ok "worker smoke check passed"
    else
        fail "worker smoke check failed (rc=$?)"
    fi
fi

echo "=== SUMMARY: pass=$PASS fail=$FAIL ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1

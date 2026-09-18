#!/bin/sh
# Apply migrations before serving. Nothing else in the stack ran
# `alembic upgrade head`, so a clean `docker compose up` produced an empty
# database and a backend that 500s on every route.
set -e
echo "[entrypoint] alembic upgrade head"
alembic upgrade head
echo "[entrypoint] starting: $*"
exec "$@"

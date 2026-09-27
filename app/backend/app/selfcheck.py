#!/usr/bin/env python3
"""Backend self-check (spec: spins nothing; validates imports + config + DB
connectivity if available). Exit 0 unless imports/config are broken — a
missing database is reported as SKIP, never a failure."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    print("=== community-insights backend selfcheck ===")

    # 1. imports (app factory pulls in models, routes, services)
    from app.config import get_settings
    from app.main import create_app

    app = create_app(start_scheduler=False)
    routes = sorted({r.path for r in app.routes})
    print(f"[ OK ] imports: FastAPI app with {len(routes)} routes")

    # 2. config
    s = get_settings()
    print(
        f"[ OK ] config: db={_host(s.database_url)} discourse={_host(s.discourse_base_url)}"
    )
    mode = {k: "stub" for k in ("ner", "priority", "sentiment", "assistant")}
    print(f"[ OK ] analysis stages: {mode}")
    print(f"[ OK ] ingest token: {'set' if s.ingest_token else 'MISSING'}")

    # 3. DB connectivity (optional)
    async def check_db() -> bool:
        from sqlalchemy import select

        from app.database import get_engine

        try:
            async with get_engine().connect() as conn:
                await conn.execute(select(1))
            return True
        except Exception as e:  # noqa: BLE001
            print(f"[SKIP] database not reachable: {type(e).__name__}: {e}")
            return False

    if asyncio.run(check_db()):
        print("[ OK ] database reachable")

    print("=== selfcheck passed ===")
    return 0


def _host(url: str) -> str:
    try:
        return url.split("//")[1].split("@")[-1].split("/")[0]
    except IndexError:
        return url


if __name__ == "__main__":
    sys.exit(main())

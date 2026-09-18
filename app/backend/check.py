import asyncio
from app.services.database_session import get_run_session
from sqlalchemy import text
async def main():
    async with get_run_session() as s:
        res = await s.execute(text("select id, kind, status, next_retry_at from job_queue"))
        for row in res.fetchall():
            print(row)
asyncio.run(main())

import asyncio
from app.services.database_session import get_run_session
from sqlalchemy import text
async def main():
    async with get_run_session() as s:
        await s.execute(text("update job_queue set next_retry_at = now() where status = 'pending'"))
        await s.commit()
asyncio.run(main())

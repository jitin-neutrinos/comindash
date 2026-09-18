import asyncio
from app.services.database_session import get_run_session
from sqlalchemy import text

async def main():
    async with get_run_session() as s:
        res = await s.execute(text("select * from audit_logs"))
        print(res.fetchall())

asyncio.run(main())

import asyncio
from app.services.database_session import get_run_session
from sqlalchemy import text
from app.models import AuditLog

async def main():
    async with get_run_session() as s:
        s.add(AuditLog(actor="test", action="test", detail={"test": 1}))
        await s.commit()
        res = await s.execute(text("select * from audit_logs"))
        print(res.fetchall())

asyncio.run(main())

import asyncio
from app.services.database_session import get_run_session
from app.services import jobs

async def main():
    async with get_run_session() as session:
        await jobs.enqueue(session, "ingest", {"triggered_by": "manual"})
        await jobs.enqueue(session, "analyze", {"triggered_by": "manual"})
        await jobs.enqueue(session, "assistant_cycle", {"triggered_by": "manual"})
    print("Enqueued ingest, analyze, assistant_cycle")

if __name__ == "__main__":
    asyncio.run(main())

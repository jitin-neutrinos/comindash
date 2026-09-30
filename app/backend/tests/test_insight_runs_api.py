import pytest
from app.models import InsightRun, InsightRunStatus
from sqlalchemy import insert
from datetime import datetime, timezone, timedelta

@pytest.mark.asyncio
async def test_insight_runs_api(client, session):
    now = datetime.now(timezone.utc)
    # Seed 3 runs
    for i in range(3):
        run = InsightRun(
            triggered_by=f"test:{i}",
            model="glm-test",
            status=InsightRunStatus.succeeded,
            created_at=now - timedelta(minutes=10 - i)
        )
        session.add(run)
    await session.commit()
    
    r = await client.get("/api/admin/insight-runs?limit=2&offset=0")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 3
    assert len(data["items"]) == 2
    assert data["items"][0]["triggered_by"] == "test:2" # newest first
    assert "cost_usd" in data["items"][0]

    run_id = data["items"][0]["id"]
    r2 = await client.get(f"/api/admin/insight-runs/{run_id}")
    assert r2.status_code == 200
    detail = r2.json()
    assert detail["run"]["id"] == run_id
    assert "insights" in detail
    assert isinstance(detail["insights"], list)
    
    r3 = await client.get("/api/admin/insight-runs/999999")
    assert r3.status_code == 404


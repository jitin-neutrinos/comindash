import pytest
from app.services.analysis import corpus_chunks, glm_client
from app.services.jobs import enqueue_assistant_on_freshness
from app.models import InsightRun, Job, JobStatus, AssistantInsight, InsightStatus
from sqlalchemy import select
from tests.corpus import seed_corpus

class DummyRow:
    def __init__(self, post, topic=None, prio=None, sent=None):
        self.Post = post
        self.Topic = topic
        self.PriorityResult = prio
        self.SentimentResult = sent

class DummyPost:
    def __init__(self, id, dpid, body_text):
        self.id = id
        self.discourse_post_id = dpid
        self.body_text = body_text

class DummyTopic:
    def __init__(self, title, category):
        self.title = title
        self.category = category

def test_make_chunks_exact_partition():
    rows = [DummyRow(DummyPost(i, i+1000, "text")) for i in range(5356)]
    chunks = corpus_chunks.make_chunks(rows, 200)
    assert len(chunks) == 27
    assert sum(len(c) for c in chunks) == 5356
    sizes = {len(c) for c in chunks}
    assert sizes == {200, 156}
    
    seen = set()
    for c in chunks:
        for r in c:
            assert r.Post.id not in seen
            seen.add(r.Post.id)

def test_render_chunk_trims_280():
    post = DummyPost(1, 1001, "a" * 500)
    topic = DummyTopic("title", "category")
    chunk_json = corpus_chunks.render_chunk([DummyRow(post, topic)])
    import json
    data = json.loads(chunk_json)
    assert len(data[0]["text"]) == 280


from contextlib import asynccontextmanager
@pytest.mark.asyncio
async def test_enqueue_assistant_on_freshness(session, monkeypatch):
    @asynccontextmanager
    async def mock_get_run_session():
        yield session

    import app.services.jobs
    import app.services.database_session
    monkeypatch.setattr(app.services.database_session, "get_run_session", mock_get_run_session)

    await session.execute(
        Job.__table__.delete().where(
            Job.payload.op('->>')('triggered_by').like('freshness:%')
        )
    )
    await session.commit()
    # NOTE: this suite runs against the SHARED insights DB. The function under
    # test commits internally, so the jobs it creates are real queue rows —
    # the delete+commit above also clears any leaked from earlier runs. The
    # like-guard keeps genuine pending assistant_cycle jobs untouched.


    job = await enqueue_assistant_on_freshness({"posts_new": 0}, "freshness:99")
    assert job is None
    
    job = await enqueue_assistant_on_freshness({"posts_new": 3}, "freshness:99")
    assert job is not None
    assert job.kind == "assistant_cycle"
    assert job.payload["triggered_by"] == "freshness:99"
    
    job2 = await enqueue_assistant_on_freshness({"posts_new": 1}, "freshness:100")
    assert job2 is None # deduped
    
    job.status = JobStatus.running
    await session.commit()
    job3 = await enqueue_assistant_on_freshness({"posts_new": 1}, "freshness:101")
    assert job3 is None # deduped against running

    # Leave the SHARED queue clean: the rows above are real committed jobs a
    # live worker would drain into real GLM runs.
    await session.execute(
        Job.__table__.delete().where(
            Job.payload.op('->>')('triggered_by').like('freshness:%')
        )
    )
    await session.commit()

@pytest.mark.asyncio
async def test_glm_result_carries_usage(monkeypatch):
    import httpx
    
    class DummyResponse:
        status_code = 200
        def json(self):
            return {
                "choices": [{"message": {"content": '{"insights": []}'}}],
                "usage": {"prompt_tokens": 1000, "completion_tokens": 200, "total_tokens": 1200}
            }
        def raise_for_status(self): pass
            
    async def mock_post(*args, **kwargs):
        return DummyResponse()
        
    monkeypatch.setenv("GLM_API_KEY", "test")
    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)
    
    res = await glm_client.chat([{"role": "user", "content": "hi"}], 100)
    assert res.prompt_tokens == 1000
    assert res.completion_tokens == 200
    assert res.total_tokens == 1200
    assert isinstance(res.payload, dict)

    class DummyResponseNoUsage:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": '{"insights": []}'}}]}
        def raise_for_status(self): pass

    async def mock_post_no_usage(*args, **kwargs):
        return DummyResponseNoUsage()

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post_no_usage)
    res2 = await glm_client.chat([{"role": "user", "content": "hi"}], 100)
    assert res2.total_tokens == 0

@pytest.mark.asyncio
async def test_posts_covered_recorded(session, monkeypatch):
    await seed_corpus(session) # 15 topics, 15 posts

    async def mock_chunk(chunk_json):
        return glm_client.GLMResult({"insights": []}, 10, 5, 15)
    
    async def mock_synth(cand_json):
        return glm_client.GLMResult({"insights": []}, 20, 10, 30)

    monkeypatch.setattr(glm_client, "request_chunk_findings", mock_chunk)
    monkeypatch.setattr(glm_client, "request_synthesis", mock_synth)
    
    from app.services.analysis.assistant import run_assistant_cycle
    await run_assistant_cycle(session)
    
    run = (await session.execute(select(InsightRun))).scalars().first()
    assert run is not None
    assert run.posts_covered == 4
    assert run.chunk_calls == 1
    assert run.prompt_tokens == 30
    assert run.completion_tokens == 15
    assert run.total_tokens == 45
    assert float(run.cost_usd) == round(45 / 1000000.0 * 1.0, 4)

@pytest.mark.asyncio
async def test_max_insights_truncation(session, monkeypatch):
    await seed_corpus(session)

    async def mock_chunk(chunk_json):
        return glm_client.GLMResult({"insights": []}, 0, 0, 0)
    
    async def mock_synth(cand_json):
        # returns 60 items
        ins = {
            "insight_type": "pain_point",
            "title": "T",
            "body": "B",
            "severity": "low",
            "evidence": [{"discourse_post_id": 101, "quote": "q"}]
        }
        return glm_client.GLMResult({"insights": [ins]*60}, 0, 0, 0)

    monkeypatch.setattr(glm_client, "request_chunk_findings", mock_chunk)
    monkeypatch.setattr(glm_client, "request_synthesis", mock_synth)
    
    from app.services.analysis.assistant import run_assistant_cycle
    await run_assistant_cycle(session)
    
    run = (await session.execute(select(InsightRun))).scalars().first()
    assert run.insights_generated == 40
    # The gate will try to insert 40.
    

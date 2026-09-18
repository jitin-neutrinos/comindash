"""Insights ingest gate: token auth, schema/evidence validation, versioned
insert + supersede, audit trail."""

from __future__ import annotations


from sqlalchemy import select

from app.models import AppConfig, AssistantInsight, InsightStatus
from tests.conftest import INGEST_TOKEN
from tests.corpus import seed_corpus


def _payload(**overrides) -> dict:
    base = {
        "assistant_version": "v1",
        "run_ref": "nightly-test",
        "insights": [
            {
                "insight_type": "pain_point",
                "title": "Debugger crashes on large projects",
                "body": "Recurring crash report cluster",
                "severity": "high",
                "evidence": [
                    {
                        "discourse_post_id": 101,
                        "quote": "The Debugger crashes every time",
                        "relevance_note": "direct report",
                    }
                ],
                "relationships": [
                    {
                        "subject_type": "entity",
                        "subject_value": "Debugger",
                        "relation": "correlates_with",
                        "object_type": "topic",
                        "object_value": "deployment",
                        "strength": 0.7,
                    }
                ],
            }
        ],
    }
    base.update(overrides)
    return base


def _hdr(token: str | None = INGEST_TOKEN) -> dict:
    return {"X-Ingest-Token": token} if token else {}


class TestTokenGate:
    async def test_missing_token_401(self, client):
        r = await client.post("/api/insights/ingest", json=_payload(), headers={})
        assert r.status_code == 401

    async def test_wrong_token_403(self, client):
        r = await client.post(
            "/api/insights/ingest", json=_payload(), headers=_hdr("nope")
        )
        assert r.status_code == 403


class TestValidation:
    async def test_unknown_evidence_post_422_with_item_errors(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        payload["insights"][0]["evidence"] = [
            {"discourse_post_id": 999999, "quote": "ghost", "relevance_note": ""}
        ]
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 422
        body = r.json()
        assert body["detail"]["errors"][0]["index"] == 0
        assert "999999" in body["detail"]["errors"][0]["errors"][0]

        audits = (
            (
                await session.execute(
                    select(AppConfig).where(AppConfig.key.like("ingest_audit%"))
                )
            )
            .scalars()
            .all()
        )
        assert len(audits) == 1
        assert audits[0].value["rejected"] == 1

    async def test_bad_severity_422(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        payload["insights"][0]["severity"] = "catastrophic"
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 422
        assert any("severity" in e for e in r.json()["detail"]["errors"])

    async def test_empty_evidence_422(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        payload["insights"][0]["evidence"] = []
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 422

    async def test_empty_insights_list_422(self, client):
        r = await client.post(
            "/api/insights/ingest", json=_payload(insights=[]), headers=_hdr()
        )
        assert r.status_code == 422

    async def test_bad_insight_type_422(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        payload["insights"][0]["insight_type"] = "vibe"
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 422

    async def test_relationship_strength_range_422(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        payload["insights"][0]["relationships"][0]["strength"] = 7.5
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 422


class TestHappyPath:
    async def test_valid_ingest_and_versioned_supersede(self, client, session):
        await seed_corpus(session)
        r = await client.post("/api/insights/ingest", json=_payload(), headers=_hdr())
        assert r.status_code == 200
        body = r.json()
        assert body["accepted"] == 1
        insight_id = body["insight_ids"][0]

        rows = (
            (
                await session.execute(
                    select(AssistantInsight).order_by(AssistantInsight.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].status is InsightStatus.active
        assert rows[0].assistant_version == "v1"

        # same title, new version → old superseded, new active
        payload_v2 = _payload(assistant_version="v2", run_ref="nightly-test-2")
        r2 = await client.post("/api/insights/ingest", json=payload_v2, headers=_hdr())
        assert r2.status_code == 200
        new_id = r2.json()["insight_ids"][0]
        assert new_id != insight_id

        # request sessions mutated row 1 — drop cached state before re-reading
        session.expire_all()
        rows = (
            (
                await session.execute(
                    select(AssistantInsight).order_by(AssistantInsight.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2
        by_status = {row.status for row in rows}
        assert by_status == {InsightStatus.active, InsightStatus.superseded}

    async def test_partial_accept(self, client, session):
        await seed_corpus(session)
        payload = _payload()
        good = dict(payload["insights"][0])
        good["title"] = "A valid one"
        bad = dict(payload["insights"][0])
        bad["title"] = "An invalid one"
        bad["evidence"] = [
            {"discourse_post_id": 424242, "quote": "x", "relevance_note": ""}
        ]
        payload["insights"] = [good, bad]
        r = await client.post("/api/insights/ingest", json=payload, headers=_hdr())
        assert r.status_code == 200
        body = r.json()
        assert body["accepted"] == 1
        assert body["rejected"] == 1


class TestAssistantSkipMode:
    async def test_cycle_without_token_is_skip_not_crash(self, session):
        from app.models import PipelineRun, RunKind
        from app.services.aihub.assistant import run_assistant_cycle

        stats = await run_assistant_cycle(session=session)
        assert stats["mode"] == "skipped"
        run = (
            await session.execute(
                select(PipelineRun).where(PipelineRun.kind == RunKind.assistant)
            )
        ).scalar_one()
        assert run.status.value == "done"
        assert run.stats["mode"] == "skipped"

    async def test_parse_assistant_reply_json_variants(self):
        from app.services.aihub.assistant import parse_assistant_reply

        assert parse_assistant_reply('{"insights": [{"title": "x"}]}') == [
            {"title": "x"}
        ]
        assert parse_assistant_reply('prose before {"insights": []} after') == []
        assert parse_assistant_reply("not json at all") == []
        assert parse_assistant_reply("") == []

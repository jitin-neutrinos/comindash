"""GET/POST /api/admin/model-versions — the WP2 registry write path.

No AI Hub API trains, deploys, or validates a model (docs/go-live-checklist.md),
so recording a version is a manual POST once a human reads the Batch-validation
metrics off the AI Hub UI. Covers: create, upsert-by-(kind,version), the
single-active-version-per-kind invariant, and the bad-kind 422.
"""

from __future__ import annotations


class TestModelVersions:
    async def test_create_and_list(self, client):
        r = await client.post(
            "/api/admin/model-versions",
            json={
                "kind": "priority",
                "version": "v1",
                "ai_hub_model_id": "model-abc",
                "metrics": {"accuracy": 0.91, "f1": 0.90},
                "training_set_ref": "training_priority.csv",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["kind"] == "priority"
        assert body["version"] == "v1"
        assert body["active"] is True
        assert body["metrics"]["f1"] == 0.90
        assert body["trained_at"] is not None

        r = await client.get("/api/admin/model-versions")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["version"] == "v1"

    async def test_upsert_same_kind_and_version_updates_in_place(self, client):
        await client.post(
            "/api/admin/model-versions",
            json={"kind": "sentiment", "version": "v1", "metrics": {"f1": 0.80}},
        )
        r = await client.post(
            "/api/admin/model-versions",
            json={"kind": "sentiment", "version": "v1", "metrics": {"f1": 0.95}},
        )
        assert r.status_code == 200
        assert r.json()["metrics"]["f1"] == 0.95

        r = await client.get("/api/admin/model-versions", params={"kind": "sentiment"})
        items = r.json()
        assert len(items) == 1  # updated, not duplicated

    async def test_only_one_active_version_per_kind(self, client):
        r1 = await client.post(
            "/api/admin/model-versions", json={"kind": "ner", "version": "v1"}
        )
        v1_id = r1.json()["id"]
        r2 = await client.post(
            "/api/admin/model-versions", json={"kind": "ner", "version": "v2"}
        )
        assert r2.json()["active"] is True

        items = (
            await client.get("/api/admin/model-versions", params={"kind": "ner"})
        ).json()
        by_id = {row["id"]: row for row in items}
        assert by_id[v1_id]["active"] is False
        assert by_id[r2.json()["id"]]["active"] is True

    async def test_bad_kind_rejected(self, client):
        r = await client.post(
            "/api/admin/model-versions",
            json={"kind": "not-a-real-kind", "version": "v1"},
        )
        assert r.status_code == 422

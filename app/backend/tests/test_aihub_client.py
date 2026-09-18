"""AI Hub client against the DOCUMENTED contract.

Endpoints, bodies and response shapes here mirror documentation.neutrinos.com
(ai-hub/integrate-apis-text-prediction, integrate-apis-text-extraction,
classification-text-service-usage, extraction-text-service-usage, tokens).
All HTTP is respx-mocked.
"""

from __future__ import annotations

import json

import pytest
import respx
from httpx import Response

from app.config import get_settings
from app.services.aihub.client import AIHubClient, AIHubError, AIHubSkip

CLASSIFICATION_RESPONSE = {
    "_id": "683d8038e17e965047a08852",
    "training_id": "6837e8ccb833a5a73e337d55",
    "review_status": "Pending",
    "output": {
        "category": {"name": "high", "confidence": 0.91},
        "categories": [
            {"name": "high", "confidence": 0.91},
            {"name": "low", "confidence": 0.09},
        ],
    },
}

EXTRACTION_RESPONSE = {
    "_id": "684809a7e648c6d2495ecd9d",
    "training_id": "6847df52e648c6d2495ebe86",
    "output": {"entities": [{"entity": "PRODUCT", "text": "Studio", "confidence": 0.99}]},
    "result": {
        "row_0": [
            {
                "entity": "PRODUCT",
                "text": "Studio",
                "confidence": 0.99,
                "position": {"start": 0, "end": 6},
            },
            {"summary": [{"entity": "PRODUCT", "total_text": 1}]},
        ]
    },
}


def _client(kind: str = "priority") -> AIHubClient:
    return AIHubClient(kind, token="tok-123", retry_wait_mult=0)


def _url(path_attr: str, **fmt) -> str:
    s = get_settings()
    path = getattr(s, path_attr)
    if fmt:
        path = path.format(**fmt)
    return f"{s.aihub_base_url}{s.aihub_api_prefix}{path}"


class TestConfiguration:
    def test_unconfigured_without_token(self):
        assert AIHubClient("ner", token="", retry_wait_mult=0).is_configured is False

    def test_token_alone_configures_the_stage(self):
        """Tokens are model+version scoped, so no deployment id is required."""
        client = AIHubClient("ner", token="tok", deployment_id="", retry_wait_mult=0)
        assert client.is_configured is True

    async def test_predict_without_token_raises_skip(self):
        client = AIHubClient("ner", token="", retry_wait_mult=0)
        with pytest.raises(AIHubSkip):
            await client.predict("text")

    async def test_predict_many_without_token_raises_skip(self):
        client = AIHubClient("sentiment", token="", retry_wait_mult=0)
        with pytest.raises(AIHubSkip):
            await client.predict_many(["a"])


class TestSingleInference:
    @respx.mock
    async def test_classification_path_body_and_auth(self):
        route = respx.post(_url("aihub_classification_single_path")).respond(
            json=CLASSIFICATION_RESPONSE
        )
        payload = await _client().predict("something is broken")
        assert payload["output"]["category"]["name"] == "high"

        request = route.calls.last.request
        assert request.headers.get("Authorization") == "Bearer tok-123"
        body = json.loads(request.content.decode())
        # documented body is {"text": ...}; no deployment id is ever sent
        assert body == {"text": "something is broken"}

    @respx.mock
    async def test_input_field_wraps_body_for_column_trained_models(self):
        get_settings.cache_clear()
        s = get_settings()
        object.__setattr__(s, "aihub_input_field", "Description")
        try:
            route = respx.post(_url("aihub_classification_single_path")).respond(
                json=CLASSIFICATION_RESPONSE
            )
            await _client().predict("hello")
            body = json.loads(route.calls.last.request.content.decode())
            assert body == {"input": {"Description": "hello"}}
        finally:
            object.__setattr__(s, "aihub_input_field", "")

    @respx.mock
    async def test_extraction_uses_the_extraction_path(self):
        route = respx.post(_url("aihub_extraction_single_path")).respond(
            json=EXTRACTION_RESPONSE
        )
        payload = await _client("ner").predict("Studio rocks")
        assert route.call_count == 1
        assert payload["result"]["row_0"][0]["position"]["start"] == 0

    @respx.mock
    async def test_retries_500_then_succeeds(self):
        route = respx.post(_url("aihub_classification_single_path"))
        route.side_effect = [
            Response(500, text="boom"),
            Response(200, json=CLASSIFICATION_RESPONSE),
        ]
        payload = await _client().predict("text")
        assert payload["_id"] == CLASSIFICATION_RESPONSE["_id"]
        assert route.call_count == 2

    @respx.mock
    async def test_429_respects_retry_after(self):
        route = respx.post(_url("aihub_classification_single_path"))
        route.side_effect = [
            Response(429, headers={"Retry-After": "0"}),
            Response(200, json=CLASSIFICATION_RESPONSE),
        ]
        await _client().predict("text")
        assert route.call_count == 2

    @respx.mock
    async def test_400_raises_aihub_error(self):
        respx.post(_url("aihub_classification_single_path")).respond(
            status_code=400, text="bad request"
        )
        with pytest.raises(AIHubError):
            await _client().predict("text")

    @respx.mock
    async def test_predict_many_isolates_one_failure(self):
        route = respx.post(_url("aihub_classification_single_path"))
        route.side_effect = [
            Response(200, json=CLASSIFICATION_RESPONSE),
            Response(400, text="nope"),
            Response(200, json=CLASSIFICATION_RESPONSE),
        ]
        results = await _client().predict_many(["a", "b", "c"])
        assert len(results) == 3
        assert sum(isinstance(r, BaseException) for r in results) == 1


class TestReviewHubReadBack:
    @respx.mock
    async def test_get_result_uses_find_one(self):
        route = respx.get(
            _url("aihub_classification_result_path", result_id="r-1")
        ).respond(json={**CLASSIFICATION_RESPONSE, "review_status": "Validated"})
        payload = await _client().get_result("r-1")
        assert payload["review_status"] == "Validated"
        assert route.call_count == 1

    @respx.mock
    async def test_send_feedback_posts_manual_classification(self):
        route = respx.post(
            _url("aihub_classification_feedback_path", result_id="r-2")
        ).respond(json={"ok": True})
        await _client().send_feedback("r-2", "low", "reclassified by reviewer")
        body = json.loads(route.calls.last.request.content.decode())
        assert body == {
            "manual_classification": "low",
            "manual_reason": "reclassified by reviewer",
        }

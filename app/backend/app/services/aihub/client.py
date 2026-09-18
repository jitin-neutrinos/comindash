"""AI Hub REST client.

Every endpoint, request body and response shape below is taken from
documentation.neutrinos.com:

- ``ai-hub/integrate-apis-text-prediction`` + ``ai-hub/classification-text-service-usage``
  single classification -> ``POST {base}/inferenceservice/classification/start/text/single``
  body ``{"text": "...", "metadata": {...}}``
  response ``{"_id", "output": {"category": {"name", "confidence"}, "categories": [...]},
               "review_status", "manual_review_flag", "training_id", ...}``
- ``ai-hub/integrate-apis-text-extraction`` + ``ai-hub/extraction-text-service-usage``
  single extraction  -> ``POST {base}/inferenceservice/extraction/start/text/single``
  response ``{"_id", "output": {"entities": [{"entity","text","confidence"}]},
               "result": {"row_0": [{..., "position": {"start","end"}}]}}``
- ``ai-hub/tokens`` — tokens are model- AND version-specific and already carry
  the deployment binding, so **no deployment id is sent in any body**.

Auth is ``Authorization: Bearer <token>``. 5xx/timeouts retry with exponential
backoff; 429 honours ``Retry-After``. A missing token means the stage is
unconfigured and callers fall back to the local stub.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

logger = logging.getLogger("aihub.client")

# stage -> (single path setting, result path setting, feedback path setting)
_STAGE_PATHS = {
    "priority": (
        "aihub_classification_single_path",
        "aihub_classification_result_path",
        "aihub_classification_feedback_path",
    ),
    "sentiment": (
        "aihub_classification_single_path",
        "aihub_classification_result_path",
        "aihub_classification_feedback_path",
    ),
    "ner": (
        "aihub_extraction_single_path",
        "aihub_extraction_result_path",
        "aihub_extraction_feedback_path",
    ),
}


class AIHubError(Exception):
    pass


class AIHubServerError(AIHubError):
    """5xx from AI Hub — retried with backoff."""


class AIHubSkip(Exception):
    """Stage is not configured (token missing) — run the stub."""


class AIHubClient:
    def __init__(
        self,
        kind: str,
        token: str | None = None,
        deployment_id: str | None = None,
        run_id: int | None = None,
        retry_wait_mult: float = 1.0,
    ):
        s = get_settings()
        self.kind = kind
        self.token = token if token is not None else s.token_for(kind)
        # Recorded for traceability only — never sent in a request body.
        self.deployment_id = (
            deployment_id
            if deployment_id is not None
            else (s.deployment_id_for(kind) if kind in _STAGE_PATHS else "")
        )
        self.base_url = s.aihub_base_url.rstrip("/") + s.aihub_api_prefix
        self.timeout = s.aihub_timeout_ms / 1000
        self.run_id = run_id
        self.retry_wait_mult = retry_wait_mult
        self._settings = s
        self._semaphore = asyncio.Semaphore(max(1, s.aihub_concurrency))

    @property
    def is_configured(self) -> bool:
        """A token is sufficient: it binds model, version and deployment."""
        return bool(self.token)

    def _require_configured(self) -> None:
        if not self.is_configured:
            raise AIHubSkip(
                f"AI Hub stage {self.kind!r} not configured (token missing) "
                f"— falling back to stub"
            )

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _path(self, which: int) -> str:
        return getattr(self._settings, _STAGE_PATHS[self.kind][which])

    def _body(self, text: str) -> dict[str, Any]:
        """Documented single-inference body.

        AI Hub text models take ``{"text": ...}``. A model trained from a
        multi-column CSV expects the training column names under ``input``
        instead — set ``AIHUB_INPUT_FIELD`` to that column name.
        """
        field = self._settings.aihub_input_field.strip()
        if field:
            return {"input": {field: text}}
        return {"text": text}

    def _log(self, event: str, level: int = logging.INFO, **fields: Any) -> None:
        logger.log(
            level, "aihub %s kind=%s run_id=%s %s", event, self.kind, self.run_id, fields
        )

    # --- plumbing -------------------------------------------------------------

    async def _request(
        self, method: str, path: str, json_body: dict | None = None
    ) -> dict:
        url = f"{self.base_url}{path}"

        @retry(
            stop=stop_after_attempt(self._settings.aihub_max_retries),
            wait=wait_exponential(multiplier=self.retry_wait_mult, min=0, max=30),
            retry=retry_if_exception_type((httpx.HTTPError, AIHubServerError)),
            reraise=True,
        )
        async def _do() -> httpx.Response:
            self._log("request", path=path)
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.request(
                    method, url, headers=self._headers(), json=json_body
                )
                if resp.status_code == 429:
                    retry_after = min(
                        float(resp.headers.get("Retry-After", "5")), 60.0
                    )
                    self._log(
                        "rate_limited",
                        logging.WARNING,
                        path=path,
                        retry_after=retry_after,
                    )
                    await asyncio.sleep(retry_after)
                    resp = await client.request(
                        method, url, headers=self._headers(), json=json_body
                    )
                if resp.status_code >= 500:
                    raise AIHubServerError(
                        f"AI Hub {resp.status_code} on {path}: {resp.text[:200]}"
                    )
                return resp

        resp = await _do()
        if resp.status_code >= 400:
            raise AIHubError(f"AI Hub {resp.status_code} on {path}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError as e:
            raise AIHubError(f"AI Hub returned non-JSON on {path}: {e}") from e

    # --- inference --------------------------------------------------------------

    async def predict(self, text: str) -> dict:
        """One single-inference call. Returns the full AI Hub result document.

        Callers keep ``_id`` (the result id) so the Review Hub verdict for this
        prediction can be pulled back later.
        """
        self._require_configured()
        async with self._semaphore:
            return await self._request("POST", self._path(0), self._body(text))

    async def predict_many(self, texts: list[str]) -> list[dict | BaseException]:
        """Bounded-concurrency fan-out over ``predict``.

        AI Hub's batch APIs are file- and multi-step oriented (create -> insert -> start
        -> poll -> results/find-all) and their results must be walked back to
        per-item ids anyway, so bounded single calls are both simpler and give
        us the result id per post directly. Concurrency is AIHUB_CONCURRENCY.
        """
        self._require_configured()
        return await asyncio.gather(
            *(self.predict(t) for t in texts), return_exceptions=True
        )

    # --- Review Hub read-back -----------------------------------------------------

    async def get_result(self, result_id: str) -> dict:
        """Fetch one stored result — carries ``review_status`` once a human has
        actioned it in the Review Hub."""
        self._require_configured()
        path = self._path(1).format(result_id=result_id)
        async with self._semaphore:
            return await self._request("GET", path)

    async def send_feedback(
        self, result_id: str, manual_value: str, reason: str = ""
    ) -> dict:
        """Push a correction back to AI Hub (``sendFeedback``), so it becomes
        eligible retraining data on the model's next Retrain in the UI."""
        self._require_configured()
        path = self._path(2).format(result_id=result_id)
        body = {"manual_classification": manual_value, "manual_reason": reason}
        async with self._semaphore:
            return await self._request("POST", path, body)

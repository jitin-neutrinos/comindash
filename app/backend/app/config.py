"""Application configuration (pydantic-settings).

ALL environment variables live here. Secrets stay server-side: nothing in this
module is ever exposed through the API. Every AI Hub / Discourse credential is
optional — missing tokens drop the corresponding stage into stub/SKIP mode so
the full stack runs end-to-end before credentials arrive.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database -----------------------------------------------------------
    database_url: str = (
        "postgresql+asyncpg://insights:insights_local@localhost:5433/insights"
    )

    # --- Discourse ----------------------------------------------------------
    discourse_base_url: str = "https://community.neutrinos.com"
    discourse_api_key: str = ""
    discourse_api_username: str = "system"
    discourse_category_id: int | None = None
    # Incremental passes stop early at the cursor, so a small cap is fine.
    # The FIRST pass (no cursor yet) is a backfill and uses the larger cap —
    # capping the backfill silently truncates forum history forever.
    discourse_max_pages: int = 20
    discourse_backfill_max_pages: int = 2000
    discourse_request_delay_ms: int = 500
    discourse_timeout_ms: int = 15000
    discourse_max_concurrency: int = 4
    discourse_post_chunk_size: int = 20

    @field_validator("discourse_category_id", mode="before")
    @classmethod
    def _blank_category_id(cls, v: object) -> object:
        # an empty env value (.env template ships one) means "no filter"
        if v == "" or v is None:
            return None
        return v

    # --- AI Hub -------------------------------------------------------------
    # Tokens are MODEL- AND VERSION-SPECIFIC and carry the deployment binding
    # (docs: ai-hub/tokens). No deployment id goes in any request body — the
    # deployment ids below are recorded on model_versions rows for traceability
    # only, and are optional.
    aihub_base_url: str = "https://aihub-staging.neutrinos.com"
    aihub_token_ner: str = ""
    aihub_token_priority: str = ""
    aihub_token_sentiment: str = ""
    aihub_assistant_token: str = ""
    aihub_ner_deployment_id: str = ""
    aihub_priority_deployment_id: str = ""
    aihub_sentiment_deployment_id: str = ""
    aihub_assistant_id: str = ""
    aihub_knowledge_source_ids: str = ""  # comma-separated; empty = auto-discover
    aihub_timeout_ms: int = 60000
    aihub_max_retries: int = 3
    aihub_concurrency: int = 4  # parallel single-inference calls per stage

    # Field name the classifier was trained on. AI Hub text models take
    # {"text": ...}; a model trained from a multi-column CSV takes
    # {"input": {"<column>": ...}} instead — set this to that column name.
    aihub_input_field: str = ""

    # Verified against documentation.neutrinos.com (ai-hub/integrate-apis-text-
    # prediction, integrate-apis-text-extraction, integrate-api-assistant and
    # the SDK usage guides). Still configurable: copy the exact cURL from a
    # model's Integration page if a sandbox path differs.
    aihub_api_prefix: str = "/inferenceservice"
    aihub_classification_single_path: str = "/classification/start/text/single"
    aihub_classification_result_path: str = "/classification/results/find-one/{result_id}"
    aihub_classification_feedback_path: str = "/classification/results/feedback/{result_id}"
    aihub_extraction_single_path: str = "/extraction/start/text/single"
    aihub_extraction_result_path: str = "/extraction/results/find-one/{result_id}"
    aihub_extraction_feedback_path: str = "/extraction/results/feedback/{result_id}"
    aihub_conversation_create_path: str = "/assistant/conversation/create"
    aihub_message_create_path: str = "/assistant/message/create"
    aihub_knowledge_find_all_path: str = "/assistant/knowledge/find-all"

    # --- Review Hub (human-in-the-loop) --------------------------------------
    # Routing to the Review Hub is a MODEL-SIDE rule configured in the AI Hub UI
    # (Feedback Loop: Always / below-threshold / Never) — there is no API for it.
    # What the backend does is poll the result ids it stored and pull verified
    # corrections back in. Retraining is likewise a UI action.
    review_poll_enabled: bool = True
    review_poll_batch: int = 200
    review_poll_interval_minutes: int = 60

    # --- Insight ingest gate -------------------------------------------------
    ingest_token: str = "change-me-local"

    # --- Pipeline behaviour ---------------------------------------------------
    scheduler_enabled: bool = True
    analysis_batch_size: int = 500  # posts analysed per stage per run
    ingest_interval_minutes: int = 60
    assistant_cycle_hour: int = 2

    @property
    def knowledge_source_ids(self) -> list[str]:
        return [
            s.strip() for s in self.aihub_knowledge_source_ids.split(",") if s.strip()
        ]

    def token_for(self, kind: str) -> str:
        """Token for an analysis stage: ner | priority | sentiment | assistant."""
        return {
            "ner": self.aihub_token_ner,
            "priority": self.aihub_token_priority,
            "sentiment": self.aihub_token_sentiment,
            "assistant": self.aihub_assistant_token,
        }[kind]

    def deployment_id_for(self, kind: str) -> str:
        return {
            "ner": self.aihub_ner_deployment_id,
            "priority": self.aihub_priority_deployment_id,
            "sentiment": self.aihub_sentiment_deployment_id,
        }[kind]


@lru_cache
def get_settings() -> Settings:
    return Settings()

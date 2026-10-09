"""Application configuration (pydantic-settings).

ALL environment variables live here. Secrets stay server-side: nothing in this
module is ever exposed through the API. Discourse credentials are optional —
a missing key drops ingestion into public/keyless mode. Analysis is served by
the host-run inference sidecar (Laya priority/sentiment + GLiNER NER); when the
sidecar is unreachable the stages fall back to deterministic stubs.
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
    # Comma-separated Discourse category ids to keep OUT of the corpus entirely
    # (internal test categories must never be indexed or analysed).
    discourse_excluded_category_ids: str = "42"
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

    # --- Insight ingest gate -------------------------------------------------
    ingest_token: str = "change-me-local"

    # --- Pipeline behaviour ---------------------------------------------------
    scheduler_enabled: bool = True
    analysis_batch_size: int = 500  # posts analysed per stage per run
    ingest_interval_minutes: int = 60
    assistant_cycle_hour: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()

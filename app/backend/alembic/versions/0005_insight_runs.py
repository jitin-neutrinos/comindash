"""insight_runs

Revision ID: 0005_insight_runs
Revises: 0004_model_registry
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0005_insight_runs"
down_revision: Union[str, None] = "0004_model_registry"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE insight_runs (
          id                 SERIAL PRIMARY KEY,
          run_id             INTEGER REFERENCES pipeline_runs(id) ON DELETE SET NULL,
          triggered_by       VARCHAR(128) NOT NULL DEFAULT '',
          model              VARCHAR(64)  NOT NULL DEFAULT '',
          status             VARCHAR(16)  NOT NULL DEFAULT 'running',
          posts_covered      INTEGER NOT NULL DEFAULT 0,
          topics_covered     INTEGER NOT NULL DEFAULT 0,
          chunk_calls        INTEGER NOT NULL DEFAULT 0,
          prompt_tokens      BIGINT  NOT NULL DEFAULT 0,
          completion_tokens  BIGINT  NOT NULL DEFAULT 0,
          total_tokens       BIGINT  NOT NULL DEFAULT 0,
          cost_usd           NUMERIC(10,4) NOT NULL DEFAULT 0,
          duration_ms        INTEGER NOT NULL DEFAULT 0,
          insights_generated INTEGER NOT NULL DEFAULT 0,
          insights_accepted  INTEGER NOT NULL DEFAULT 0,
          insights_rejected  INTEGER NOT NULL DEFAULT 0,
          error              TEXT,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute(
        "CREATE INDEX ix_insight_runs_created_at ON insight_runs (created_at);"
    )

def downgrade() -> None:
    op.execute("DROP TABLE insight_runs;")

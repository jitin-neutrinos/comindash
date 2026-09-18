"""per-stage analysis markers on posts + AI Hub result ids on result rows

Revision ID: 0003_analysis_markers
Revises: c7893ae024fb
Create Date: 2026-09-11

Why:
- posts.{ner,priority,sentiment}_model_version — a stage is "done" for a post
  when its marker is set, not when a result row exists. A post that yields zero
  entities used to be re-selected (and, with real tokens, re-billed) on every
  run forever. Existing rows are backfilled from the results already stored.
- {extractions,priority_results,sentiment_results}.aihub_result_id — the AI Hub
  result ``_id``, so the Review Hub verdict for a prediction can be pulled back
  (services/aihub/review.py).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_analysis_markers"
down_revision: Union[str, None] = "c7893ae024fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("posts", sa.Column("ner_model_version", sa.String(64), nullable=True))
    op.add_column(
        "posts", sa.Column("priority_model_version", sa.String(64), nullable=True)
    )
    op.add_column(
        "posts", sa.Column("sentiment_model_version", sa.String(64), nullable=True)
    )
    for table in ("extractions", "priority_results", "sentiment_results"):
        op.add_column(
            table, sa.Column("aihub_result_id", sa.String(64), nullable=True)
        )

    # Backfill markers from the results already stored, so the first run after
    # this migration does not re-analyse the whole corpus.
    for column, source in (
        ("ner_model_version", "extractions"),
        ("priority_model_version", "priority_results"),
        ("sentiment_model_version", "sentiment_results"),
    ):
        op.execute(
            f"""
            UPDATE posts SET {column} = latest.model_version
            FROM (
                SELECT DISTINCT ON (post_id) post_id, model_version
                FROM {source} ORDER BY post_id, created_at DESC
            ) AS latest
            WHERE posts.id = latest.post_id
            """
        )

    # audit_logs.ts was created without a timezone, unlike every other
    # timestamp in the schema
    op.alter_column(
        "audit_logs",
        "ts",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.DateTime(),
        postgresql_using="ts AT TIME ZONE 'UTC'",
    )

    op.create_index(
        "ix_posts_ner_model_version", "posts", ["ner_model_version"]
    )
    op.create_index(
        "ix_posts_priority_model_version", "posts", ["priority_model_version"]
    )
    op.create_index(
        "ix_posts_sentiment_model_version", "posts", ["sentiment_model_version"]
    )


def downgrade() -> None:
    op.drop_index("ix_posts_sentiment_model_version", table_name="posts")
    op.drop_index("ix_posts_priority_model_version", table_name="posts")
    op.drop_index("ix_posts_ner_model_version", table_name="posts")
    for table in ("extractions", "priority_results", "sentiment_results"):
        op.drop_column(table, "aihub_result_id")
    op.drop_column("posts", "sentiment_model_version")
    op.drop_column("posts", "priority_model_version")
    op.drop_column("posts", "ner_model_version")

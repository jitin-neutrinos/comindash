"""initial schema: all tables, indexes and reporting views

Revision ID: 0001_initial
Revises:
Create Date: 2026-09-09

Matches app/models.py exactly (specs/SPEC.md schema is authoritative).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enum(name: str, values: list[str]) -> sa.CheckConstraint:
    return sa.CheckConstraint(
        f"{name} IN ({', '.join(repr(v) for v in values)})", name=f"ck_{name}_values"
    )


def upgrade() -> None:
    op.create_table(
        "forums",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column(
            "cursor_state", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("last_ingested_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("base_url"),
    )

    op.create_table(
        "topics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("forum_id", sa.Integer(), nullable=False),
        sa.Column("discourse_topic_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=256), nullable=False),
        sa.Column("slug", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False),
        sa.Column("like_count", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["forum_id"], ["forums.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("discourse_topic_id"),
    )
    op.create_index("ix_topics_forum_id", "topics", ["forum_id"])

    op.create_table(
        "posts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=False),
        sa.Column("discourse_post_id", sa.Integer(), nullable=False),
        sa.Column("post_number", sa.Integer(), nullable=False),
        sa.Column("author_hash", sa.String(length=64), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("discourse_post_id"),
    )
    op.create_index("ix_posts_topic_id", "posts", ["topic_id"])
    op.create_index("ix_posts_created_at", "posts", ["created_at"])

    op.create_table(
        "ingestion_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("forum_id", sa.Integer(), nullable=False),
        sa.Column("since_cursor", sa.String(length=64), nullable=True),
        sa.Column("pages_done", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["forum_id"], ["forums.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ingestion_state_forum_id", "ingestion_state", ["forum_id"])

    op.create_table(
        "pipeline_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("triggered_by", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        _enum("kind", ["ingest", "analyze", "assistant"]),
        _enum("status", ["pending", "running", "done", "failed"]),
    )
    op.create_index(
        "ix_pipeline_runs_kind_started", "pipeline_runs", ["kind", "started_at"]
    )

    op.create_table(
        "extractions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("entity_text", sa.Text(), nullable=False),
        sa.Column("entity_label", sa.String(length=64), nullable=False),
        sa.Column("start_pos", sa.Integer(), nullable=False),
        sa.Column("end_pos", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_extractions_post_id", "extractions", ["post_id"])
    op.create_index("ix_extractions_run_id", "extractions", ["run_id"])
    op.create_index("ix_extractions_created_at", "extractions", ["created_at"])

    op.create_table(
        "priority_results",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.String(length=24), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("reviewed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        _enum("priority", ["high", "medium", "low"]),
    )
    op.create_index("ix_priority_results_post_id", "priority_results", ["post_id"])
    op.create_index("ix_priority_results_run_id", "priority_results", ["run_id"])
    op.create_index(
        "ix_priority_results_priority_confidence",
        "priority_results",
        ["priority", "confidence"],
    )
    op.create_index(
        "ix_priority_results_created_at", "priority_results", ["created_at"]
    )

    op.create_table(
        "sentiment_results",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("sentiment", sa.String(length=24), nullable=False),
        sa.Column("intensity", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("reviewed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        _enum("sentiment", ["pos", "neu", "neg"]),
    )
    op.create_index("ix_sentiment_results_post_id", "sentiment_results", ["post_id"])
    op.create_index("ix_sentiment_results_run_id", "sentiment_results", ["run_id"])
    op.create_index(
        "ix_sentiment_results_sentiment", "sentiment_results", ["sentiment"]
    )
    op.create_index(
        "ix_sentiment_results_created_at", "sentiment_results", ["created_at"]
    )

    op.create_table(
        "assistant_insights",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("assistant_version", sa.String(length=64), nullable=False),
        sa.Column("insight_type", sa.String(length=24), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("priority_rollup", sa.String(length=16), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["pipeline_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        _enum(
            "insight_type",
            ["pain_point", "trend", "anomaly", "relationship", "recommendation"],
        ),
        _enum("status", ["active", "resolved", "superseded"]),
    )
    op.create_index("ix_assistant_insights_run_id", "assistant_insights", ["run_id"])
    op.create_index(
        "ix_assistant_insights_created_at", "assistant_insights", ["created_at"]
    )
    op.create_index(
        "ix_assistant_insights_type_status",
        "assistant_insights",
        ["insight_type", "status"],
    )

    op.create_table(
        "insight_evidence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("insight_id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("relevance_note", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["insight_id"], ["assistant_insights.id"]),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_insight_evidence_insight_id", "insight_evidence", ["insight_id"]
    )
    op.create_index("ix_insight_evidence_post_id", "insight_evidence", ["post_id"])

    op.create_table(
        "insight_relationships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("insight_id", sa.Integer(), nullable=False),
        sa.Column("subject_type", sa.String(length=64), nullable=False),
        sa.Column("subject_value", sa.Text(), nullable=False),
        sa.Column("relation", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=False),
        sa.Column("object_value", sa.Text(), nullable=False),
        sa.Column("strength", sa.Float(), nullable=False),
        sa.Column(
            "evidence_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.ForeignKeyConstraint(["insight_id"], ["assistant_insights.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_insight_relationships_insight_id", "insight_relationships", ["insight_id"]
    )

    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("ai_hub_model_id", sa.String(length=128), nullable=False),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("trained_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("training_set_ref", sa.String(length=256), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        _enum("kind", ["ner", "priority", "sentiment", "assistant"]),
    )

    op.create_table(
        "review_feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("result_type", sa.String(length=32), nullable=False),
        sa.Column("result_id", sa.Integer(), nullable=False),
        sa.Column("original_value", sa.String(length=64), nullable=False),
        sa.Column("corrected_value", sa.String(length=64), nullable=False),
        sa.Column("reviewed_by", sa.String(length=128), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "job_queue",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(length=128), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        _enum("status", ["pending", "running", "done", "failed", "dead"]),
    )
    op.create_index(
        "ix_job_queue_status_next_retry", "job_queue", ["status", "next_retry_at"]
    )

    op.create_table(
        "app_config",
        sa.Column("key", sa.String(length=256), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )

    # --- reporting views (SPEC.md) -------------------------------------------
    op.execute(
        """
        CREATE VIEW daily_topic_metrics AS
        SELECT t.id AS topic_id,
               t.title,
               date(p.created_at) AS day,
               count(p.id) AS posts_count,
               avg(CASE WHEN pr.priority = 'high' THEN 1.0
                        WHEN pr.priority = 'medium' THEN 0.5
                        ELSE 0.0 END) AS avg_priority_score
        FROM topics t
        JOIN posts p ON p.topic_id = t.id
        LEFT JOIN priority_results pr ON pr.post_id = p.id
        GROUP BY t.id, t.title, date(p.created_at)
        """
    )
    op.execute(
        """
        CREATE VIEW weekly_entity_metrics AS
        SELECT e.entity_text,
               e.entity_label,
               date_trunc('week', p.created_at) AS week,
               count(*) AS mention_count
        FROM extractions e
        JOIN posts p ON p.id = e.post_id
        GROUP BY e.entity_text, e.entity_label, date_trunc('week', p.created_at)
        """
    )
    op.execute(
        """
        CREATE VIEW sentiment_trends AS
        SELECT date(p.created_at) AS day,
               sr.sentiment,
               avg(sr.intensity) AS avg_intensity,
               count(*) AS result_count
        FROM sentiment_results sr
        JOIN posts p ON p.id = sr.post_id
        GROUP BY date(p.created_at), sr.sentiment
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS sentiment_trends")
    op.execute("DROP VIEW IF EXISTS weekly_entity_metrics")
    op.execute("DROP VIEW IF EXISTS daily_topic_metrics")
    for table in (
        "app_config",
        "job_queue",
        "review_feedback",
        "model_versions",
        "insight_relationships",
        "insight_evidence",
        "assistant_insights",
        "sentiment_results",
        "priority_results",
        "extractions",
        "pipeline_runs",
        "ingestion_state",
        "posts",
        "topics",
        "forums",
    ):
        op.drop_table(table)

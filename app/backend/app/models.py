"""SQLAlchemy ORM models — the schema in specs/SPEC.md is authoritative.

Notes:
- ``native_enum=False`` so the same models create valid tables on PostgreSQL
  (VARCHAR + CHECK, via Alembic) and on SQLite (tests) with zero divergence.
- JSONB gains a SQLite ``JSON`` variant for the same reason.
- Views (daily_topic_metrics, weekly_entity_metrics, sentiment_trends) live in
  the Alembic migration — they are read helpers, not ORM state.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (func, 
    JSON,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSONField = JSONB().with_variant(JSON(), "sqlite")


class Base(DeclarativeBase):
    pass


def _enum(e: type[enum.Enum], length: int = 24) -> SAEnum:
    return SAEnum(
        e,
        native_enum=False,
        length=length,
        values_callable=lambda x: [m.value for m in x],
    )


class RunKind(str, enum.Enum):
    ingest = "ingest"
    analyze = "analyze"
    assistant = "assistant"


class RunStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class Priority(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"


class Sentiment(str, enum.Enum):
    pos = "pos"
    neu = "neu"
    neg = "neg"


class InsightType(str, enum.Enum):
    pain_point = "pain_point"
    trend = "trend"
    anomaly = "anomaly"
    relationship = "relationship"
    recommendation = "recommendation"


class InsightStatus(str, enum.Enum):
    active = "active"
    resolved = "resolved"
    superseded = "superseded"


class ModelKind(str, enum.Enum):
    ner = "ner"
    priority = "priority"
    sentiment = "sentiment"
    assistant = "assistant"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"
    dead = "dead"


class Forum(Base):
    __tablename__ = "forums"

    id: Mapped[int] = mapped_column(primary_key=True)
    base_url: Mapped[str] = mapped_column(String(512), unique=True)
    name: Mapped[str] = mapped_column(String(256), default="")
    cursor_state: Mapped[dict] = mapped_column(JSONField, default=dict)
    last_ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (Index("ix_topics_forum_id", "forum_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    forum_id: Mapped[int] = mapped_column(ForeignKey("forums.id"))
    discourse_topic_id: Mapped[int] = mapped_column(Integer, unique=True)
    title: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(256), default="")
    slug: Mapped[str] = mapped_column(String(512), default="")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    posts_count: Mapped[int] = mapped_column(Integer, default=0)
    views: Mapped[int] = mapped_column(Integer, default=0)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        Index("ix_posts_topic_id", "topic_id"),
        Index("ix_posts_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id"))
    discourse_post_id: Mapped[int] = mapped_column(Integer, unique=True)
    post_number: Mapped[int] = mapped_column(Integer, default=1)
    author_hash: Mapped[str] = mapped_column(String(64), default="")
    body_text: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(16), default="en")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    # Per-stage completion markers. A stage is "done" for this post when its
    # column holds the model_version that analysed it — NOT when a result row
    # exists, because a post can legitimately yield zero entities and would
    # otherwise be re-analysed on every run, forever. Cleared when the body
    # text changes (edited post) so the post is re-analysed once.
    ner_model_version: Mapped[str | None] = mapped_column(String(64))
    priority_model_version: Mapped[str | None] = mapped_column(String(64))
    sentiment_model_version: Mapped[str | None] = mapped_column(String(64))


class IngestionState(Base):
    __tablename__ = "ingestion_state"
    __table_args__ = (Index("ix_ingestion_state_forum_id", "forum_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    forum_id: Mapped[int] = mapped_column(ForeignKey("forums.id"))
    since_cursor: Mapped[str | None] = mapped_column(String(64))
    pages_done: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="running")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"
    __table_args__ = (Index("ix_pipeline_runs_kind_started", "kind", "started_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[RunKind] = mapped_column(_enum(RunKind))
    status: Mapped[RunStatus] = mapped_column(
        _enum(RunStatus), default=RunStatus.pending
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict] = mapped_column(JSONField, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    triggered_by: Mapped[str] = mapped_column(String(128), default="")


class Extraction(Base):
    __tablename__ = "extractions"
    __table_args__ = (
        Index("ix_extractions_post_id", "post_id"),
        Index("ix_extractions_run_id", "run_id"),
        Index("ix_extractions_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"))
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"))
    model_version: Mapped[str] = mapped_column(String(64))
    entity_text: Mapped[str] = mapped_column(Text, default="")
    entity_label: Mapped[str] = mapped_column(String(64), default="")
    start_pos: Mapped[int] = mapped_column(Integer, default=0)
    end_pos: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    aihub_result_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PriorityResult(Base):
    __tablename__ = "priority_results"
    __table_args__ = (
        Index("ix_priority_results_post_id", "post_id"),
        Index("ix_priority_results_run_id", "run_id"),
        Index("ix_priority_results_priority_confidence", "priority", "confidence"),
        Index("ix_priority_results_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"))
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"))
    model_version: Mapped[str] = mapped_column(String(64))
    priority: Mapped[Priority] = mapped_column(_enum(Priority))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    aihub_result_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SentimentResult(Base):
    __tablename__ = "sentiment_results"
    __table_args__ = (
        Index("ix_sentiment_results_post_id", "post_id"),
        Index("ix_sentiment_results_run_id", "run_id"),
        Index("ix_sentiment_results_sentiment", "sentiment"),
        Index("ix_sentiment_results_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"))
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"))
    model_version: Mapped[str] = mapped_column(String(64))
    sentiment: Mapped[Sentiment] = mapped_column(_enum(Sentiment))
    intensity: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    aihub_result_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AssistantInsight(Base):
    __tablename__ = "assistant_insights"
    __table_args__ = (
        Index("ix_assistant_insights_run_id", "run_id"),
        Index("ix_assistant_insights_created_at", "created_at"),
        Index("ix_assistant_insights_type_status", "insight_type", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("pipeline_runs.id"))
    assistant_version: Mapped[str] = mapped_column(String(64), default="")
    insight_type: Mapped[InsightType] = mapped_column(_enum(InsightType))
    title: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(16), default="")
    priority_rollup: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[InsightStatus] = mapped_column(
        _enum(InsightStatus), default=InsightStatus.active
    )
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InsightEvidence(Base):
    __tablename__ = "insight_evidence"
    __table_args__ = (
        Index("ix_insight_evidence_insight_id", "insight_id"),
        Index("ix_insight_evidence_post_id", "post_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    insight_id: Mapped[int] = mapped_column(ForeignKey("assistant_insights.id"))
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"))
    quote: Mapped[str] = mapped_column(Text, default="")
    relevance_note: Mapped[str] = mapped_column(Text, default="")


class InsightRelationship(Base):
    __tablename__ = "insight_relationships"
    __table_args__ = (Index("ix_insight_relationships_insight_id", "insight_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    insight_id: Mapped[int] = mapped_column(ForeignKey("assistant_insights.id"))
    subject_type: Mapped[str] = mapped_column(String(64), default="")
    subject_value: Mapped[str] = mapped_column(Text, default="")
    relation: Mapped[str] = mapped_column(String(64), default="")
    object_type: Mapped[str] = mapped_column(String(64), default="")
    object_value: Mapped[str] = mapped_column(Text, default="")
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    evidence_ids: Mapped[list] = mapped_column(JSONField, default=list)


class ModelVersion(Base):
    """One registered version of one model.

    The registry — not a doc — answers "what is serving, trained from what, on
    which commit". ``git_history`` is a snapshot of ``git log`` for
    ``git_paths``, written by ml/scripts/register_model.py at registration
    time: the API container has neither git nor a repo mount, so it can only
    read what the host recorded.
    """

    __tablename__ = "model_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[ModelKind] = mapped_column(_enum(ModelKind))
    version: Mapped[str] = mapped_column(String(64))
    ai_hub_model_id: Mapped[str] = mapped_column(String(128), default="")
    metrics: Mapped[dict] = mapped_column(JSONField, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    trained_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    training_set_ref: Mapped[str] = mapped_column(String(256), default="")

    # --- provenance -------------------------------------------------------
    display_name: Mapped[str] = mapped_column(String(128), default="")
    task: Mapped[str] = mapped_column(String(256), default="")
    base_model: Mapped[str] = mapped_column(String(256), default="")
    architecture: Mapped[str] = mapped_column(String(128), default="")
    param_count: Mapped[str] = mapped_column(String(32), default="")
    checkpoint_path: Mapped[str] = mapped_column(String(512), default="")
    serving_via: Mapped[str] = mapped_column(String(64), default="")
    stage: Mapped[str] = mapped_column(String(24), default="registered")
    provider: Mapped[str] = mapped_column(String(64), default="")
    license: Mapped[str] = mapped_column(String(128), default="")
    provenance_url: Mapped[str] = mapped_column(String(512), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # --- git --------------------------------------------------------------
    git_commit: Mapped[str] = mapped_column(String(64), default="")
    git_subject: Mapped[str] = mapped_column(String(512), default="")
    git_author: Mapped[str] = mapped_column(String(128), default="")
    git_committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    git_paths: Mapped[list] = mapped_column(JSONField, default=list)
    git_history: Mapped[list] = mapped_column(JSONField, default=list)

    hyperparams: Mapped[dict | list] = mapped_column(JSONField, default=dict)
    calibration: Mapped[dict | list] = mapped_column(JSONField, default=dict)
    labels: Mapped[list] = mapped_column(JSONField, default=list)


class ModelTrainingRun(Base):
    """A training/finetune/experiment run — including the rejected ones.

    A registry that lists only winners hides why the live model is still live.
    ``outcome`` carries that: deployed | rejected | superseded | experimental.
    """

    __tablename__ = "model_training_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    model_version_id: Mapped[int] = mapped_column(
        ForeignKey("model_versions.id", ondelete="CASCADE"), index=True
    )
    run_type: Mapped[str] = mapped_column(String(32), default="finetune")
    label: Mapped[str] = mapped_column(String(128), default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_hours: Mapped[float | None] = mapped_column(Float)
    epochs: Mapped[int | None] = mapped_column(Integer)
    final_loss: Mapped[float | None] = mapped_column(Float)
    hardware: Mapped[str] = mapped_column(String(128), default="")
    dataset_ref: Mapped[str] = mapped_column(String(512), default="")
    dataset: Mapped[dict] = mapped_column(JSONField, default=dict)
    hyperparams: Mapped[dict] = mapped_column(JSONField, default=dict)
    outcome: Mapped[str] = mapped_column(String(32), default="deployed")
    outcome_reason: Mapped[str] = mapped_column(Text, default="")
    git_commit: Mapped[str] = mapped_column(String(64), default="")
    git_subject: Mapped[str] = mapped_column(String(512), default="")
    git_committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    log_path: Mapped[str] = mapped_column(String(512), default="")
    doc_ref: Mapped[str] = mapped_column(String(512), default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class ModelEvaluation(Base):
    """Measured quality for one version. ``per_class`` holds what was measured
    (precision/recall/f1/support per label) so the UI never derives a number it
    was not given."""

    __tablename__ = "model_evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    model_version_id: Mapped[int] = mapped_column(
        ForeignKey("model_versions.id", ondelete="CASCADE"), index=True
    )
    training_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_training_runs.id", ondelete="SET NULL")
    )
    eval_type: Mapped[str] = mapped_column(String(32), default="holdout")
    eval_set_ref: Mapped[str] = mapped_column(String(512), default="")
    eval_rows: Mapped[int | None] = mapped_column(Integer)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accuracy: Mapped[float | None] = mapped_column(Float)
    macro_f1: Mapped[float | None] = mapped_column(Float)
    per_class: Mapped[dict] = mapped_column(JSONField, default=dict)
    confusion: Mapped[dict] = mapped_column(JSONField, default=dict)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    git_commit: Mapped[str] = mapped_column(String(64), default="")
    doc_ref: Mapped[str] = mapped_column(String(512), default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class ReviewFeedback(Base):
    __tablename__ = "review_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    result_type: Mapped[str] = mapped_column(String(32), default="")
    result_id: Mapped[int] = mapped_column(Integer)
    original_value: Mapped[str] = mapped_column(String(64), default="")
    corrected_value: Mapped[str] = mapped_column(String(64), default="")
    reviewed_by: Mapped[str] = mapped_column(String(128), default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Job(Base):
    __tablename__ = "job_queue"
    __table_args__ = (
        Index("ix_job_queue_status_next_retry", "status", "next_retry_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSONField, default=dict)
    status: Mapped[JobStatus] = mapped_column(
        _enum(JobStatus), default=JobStatus.pending
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str | None] = mapped_column(String(128))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)


class AppConfig(Base):
    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(256), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONField, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now())
    actor: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(256), nullable=True)
    detail: Mapped[dict | list | None] = mapped_column(JSONField, nullable=True)

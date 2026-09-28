"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Health -----------------------------------------------------------------


class LastRunOut(ORMModel):
    kind: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class HealthOut(BaseModel):
    status: str
    db: str
    scheduler: str
    last_run: dict[str, LastRunOut]


# --- Overview -----------------------------------------------------------------


class DeltaOut(BaseModel):
    """A measured change between a recent window and the one before it.

    ``value`` is the current figure, ``previous`` the same figure one window
    back, ``direction`` one of up/down/flat. ``pct`` is None when there is no
    baseline to divide by — rendering "+∞%" or a silent 0 would both lie.
    """

    value: float
    previous: float
    pct: float | None = None
    direction: str = "flat"
    window_days: int = 14


class OverviewOut(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    total_posts: int
    total_topics: int
    avg_sentiment: float
    high_priority_count: int
    active_pain_points: int
    model_confidence: float
    pipeline_health: dict[str, LastRunOut]
    # Movement for the headline KPIs. Empty dict when the corpus is too young
    # to have two comparable windows.
    deltas: dict[str, DeltaOut] = {}
    last_post_at: datetime | None = None


# --- Insights -------------------------------------------------------------------


class EvidenceOut(ORMModel):
    post_id: int
    discourse_post_id: int | None = None
    topic_id: int | None = None
    topic_title: str | None = None
    quote: str
    relevance_note: str
    url: str | None = None


class RelationshipOut(ORMModel):
    subject_type: str
    subject_value: str
    relation: str
    object_type: str
    object_value: str
    strength: float


class InsightOut(ORMModel):
    id: int
    # Canonical URL segment (`<slug>-<id>`), derived from the title server-side
    # so clients never have to reimplement slugification and drift from it.
    slug: str = ""
    insight_type: str
    title: str
    body: str
    severity: str
    priority_rollup: str | None = None
    status: str
    assistant_version: str
    valid_from: datetime | None = None
    created_at: datetime | None = None
    evidence_count: int = 0


class InsightDetailOut(InsightOut):
    evidence: list[EvidenceOut] = []
    relationships: list[RelationshipOut] = []


class IngestErrorItem(BaseModel):
    index: int
    errors: list[str]


class IngestResultOut(BaseModel):
    accepted: int
    rejected: int
    insight_ids: list[int]
    errors: list[IngestErrorItem]


# --- Pain points --------------------------------------------------------------


class PainPointOut(InsightOut):
    pass


# --- Trends ---------------------------------------------------------------------


class TrendPointOut(BaseModel):
    date: str
    value: float
    extra: dict[str, float] = {}


# --- Topics / Posts -------------------------------------------------------------


class TopicOut(ORMModel):
    id: int
    discourse_topic_id: int
    title: str
    category: str
    slug: str
    created_at: datetime | None = None
    last_posted_at: datetime | None = None
    posts_count: int
    views: int
    like_count: int


class AnalysisBadge(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    priority: str | None = None
    priority_confidence: float | None = None
    sentiment: str | None = None
    sentiment_intensity: float | None = None
    sentiment_confidence: float | None = None
    model_version: str | None = None


class PostOut(ORMModel):
    id: int
    discourse_post_id: int
    topic_id: int
    post_number: int
    author_hash: str
    # An excerpt, not the body. Post bodies run to 12KB+ (release notes), and
    # the only consumer renders a two-line preview — shipping the full text
    # made a 25-row page several megabytes.
    excerpt: str = ""
    language: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    ingested_at: datetime | None = None
    # Topic context, so a row can name its thread and link back to Discourse.
    topic_title: str = ""
    topic_slug: str = ""
    topic_discourse_id: int | None = None
    analysis: AnalysisBadge = Field(default_factory=AnalysisBadge)


class PaginatedOut(BaseModel):
    items: list
    total: int
    limit: int
    offset: int


# --- Runs / Relationships --------------------------------------------------------


class RunOut(ORMModel):
    id: int
    kind: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    stats: dict
    error: str | None = None
    triggered_by: str


class GraphNode(BaseModel):
    id: str
    label: str
    type: str


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str
    strength: float
    insight_id: int


class RelationshipGraphOut(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# --- Model registry (WP2 accuracy loop) --------------------------------------
# Recorded by hand from the AI Hub UI: there is no training/deploy/validate API
# (docs/go-live-checklist.md), so this is the write path for the numbers a
# human reads off the model's Details/Test page after Batch validation.


class ModelVersionIn(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    kind: str  # ner | priority | sentiment | assistant
    version: str
    ai_hub_model_id: str = ""
    metrics: dict = Field(default_factory=dict)  # accuracy/precision/recall/f1/confidence
    active: bool = True
    trained_at: datetime | None = None
    training_set_ref: str = ""


class ModelVersionOut(ORMModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    kind: str
    version: str
    ai_hub_model_id: str
    metrics: dict
    active: bool
    trained_at: datetime | None = None
    training_set_ref: str

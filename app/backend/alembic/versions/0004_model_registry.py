"""model registry: provenance columns on model_versions + training runs + evaluations

Revision ID: 0004_model_registry
Revises: 0003_analysis_markers
Create Date: 2026-09-28

Why:
The /review page has to answer "which model, trained how, on what data, scoring
what, committed as which git sha" without anyone re-reading docs/ or grepping
training logs. That means the registry is the source of truth, not a doc:

- model_versions gains provenance (base model, architecture, checkpoint path,
  serving path, lifecycle stage) and git columns. ``git_history`` is a snapshot
  of ``git log`` for the paths that define the model, taken at registration
  time by ml/scripts/register_model.py — the API container has no git and no
  repo mount, so the host writes the snapshot in.
- model_training_runs records every train/finetune/experiment, INCLUDING the
  rejected ones. A registry that only lists winners hides why the live model is
  still the live model (see docs/laya-product-context-experiment-2026-09-28.md).
- model_evaluations stores per-class precision/recall/F1/support as measured,
  separated from the headline accuracy, so the UI never has to derive a number
  it was not given.

``metrics``/``active``/``ai_hub_model_id`` on model_versions are kept as-is:
the existing POST /api/admin/model-versions write path keeps working unchanged.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_model_registry"
down_revision: Union[str, None] = "0003_analysis_markers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB(astext_type=sa.Text())

# Lifecycle: what this version IS right now, independent of `active`.
#   live        — serving production traffic
#   challenger  — trained + evaluated, not promoted
#   experiment  — research run, never intended for production
#   retired     — was live, superseded
#   registered  — recorded, not yet evaluated
STAGES = ("live", "challenger", "experiment", "retired", "registered")


def upgrade() -> None:
    cols = [
        ("display_name", sa.String(128), ""),
        ("task", sa.String(256), ""),
        ("base_model", sa.String(256), ""),
        ("architecture", sa.String(128), ""),
        ("param_count", sa.String(32), ""),
        ("checkpoint_path", sa.String(512), ""),
        ("serving_via", sa.String(64), ""),
        ("stage", sa.String(24), "registered"),
        ("provider", sa.String(64), ""),
        ("license", sa.String(128), ""),
        ("provenance_url", sa.String(512), ""),
        ("notes", sa.Text(), ""),
        ("git_commit", sa.String(64), ""),
        ("git_subject", sa.String(512), ""),
        ("git_author", sa.String(128), ""),
    ]
    for name, type_, default in cols:
        op.add_column(
            "model_versions",
            sa.Column(name, type_, nullable=False, server_default=str(default)),
        )
    op.add_column(
        "model_versions", sa.Column("git_committed_at", sa.DateTime(timezone=True))
    )
    op.add_column("model_versions", sa.Column("deployed_at", sa.DateTime(timezone=True)))
    op.add_column("model_versions", sa.Column("retired_at", sa.DateTime(timezone=True)))
    for name in ("git_paths", "git_history", "hyperparams", "calibration", "labels"):
        op.add_column(
            "model_versions",
            sa.Column(name, JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        )
    op.create_check_constraint(
        "ck_model_versions_stage", "model_versions", f"stage IN {STAGES}"
    )
    op.create_index("ix_model_versions_stage", "model_versions", ["stage"])
    op.create_unique_constraint(
        "uq_model_versions_kind_version", "model_versions", ["kind", "version"]
    )

    op.create_table(
        "model_training_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "model_version_id",
            sa.Integer,
            sa.ForeignKey("model_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_type", sa.String(32), nullable=False, server_default="finetune"),
        sa.Column("label", sa.String(128), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("duration_hours", sa.Float),
        sa.Column("epochs", sa.Integer),
        sa.Column("final_loss", sa.Float),
        sa.Column("hardware", sa.String(128), nullable=False, server_default=""),
        sa.Column("dataset_ref", sa.String(512), nullable=False, server_default=""),
        sa.Column("dataset", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "hyperparams", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        # deployed | rejected | superseded | experimental
        sa.Column("outcome", sa.String(32), nullable=False, server_default="deployed"),
        sa.Column("outcome_reason", sa.Text, nullable=False, server_default=""),
        sa.Column("git_commit", sa.String(64), nullable=False, server_default=""),
        sa.Column("git_subject", sa.String(512), nullable=False, server_default=""),
        sa.Column("git_committed_at", sa.DateTime(timezone=True)),
        sa.Column("log_path", sa.String(512), nullable=False, server_default=""),
        sa.Column("doc_ref", sa.String(512), nullable=False, server_default=""),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
    )
    op.create_index(
        "ix_model_training_runs_version", "model_training_runs", ["model_version_id"]
    )

    op.create_table(
        "model_evaluations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "model_version_id",
            sa.Integer,
            sa.ForeignKey("model_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "training_run_id",
            sa.Integer,
            sa.ForeignKey("model_training_runs.id", ondelete="SET NULL"),
        ),
        # holdout | heldout_sample | batch_test | live
        sa.Column("eval_type", sa.String(32), nullable=False, server_default="holdout"),
        sa.Column("eval_set_ref", sa.String(512), nullable=False, server_default=""),
        sa.Column("eval_rows", sa.Integer),
        sa.Column("evaluated_at", sa.DateTime(timezone=True)),
        sa.Column("accuracy", sa.Float),
        sa.Column("macro_f1", sa.Float),
        # {label: {precision, recall, f1, support}} — as MEASURED, never derived
        sa.Column(
            "per_class", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column(
            "confusion", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("is_current", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("git_commit", sa.String(64), nullable=False, server_default=""),
        sa.Column("doc_ref", sa.String(512), nullable=False, server_default=""),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
    )
    op.create_index(
        "ix_model_evaluations_version", "model_evaluations", ["model_version_id"]
    )


def downgrade() -> None:
    op.drop_table("model_evaluations")
    op.drop_table("model_training_runs")
    op.drop_constraint("uq_model_versions_kind_version", "model_versions", type_="unique")
    op.drop_index("ix_model_versions_stage", table_name="model_versions")
    op.drop_constraint("ck_model_versions_stage", "model_versions", type_="check")
    for name in (
        "labels", "calibration", "hyperparams", "git_history", "git_paths",
        "retired_at", "deployed_at", "git_committed_at",
        "git_author", "git_subject", "git_commit", "notes", "provenance_url",
        "license", "provider", "stage", "serving_via", "checkpoint_path",
        "param_count", "architecture", "base_model", "task", "display_name",
    ):
        op.drop_column("model_versions", name)

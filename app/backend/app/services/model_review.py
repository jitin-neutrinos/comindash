"""Review-page assembly: the model registry + what the corpus actually shows.

Two rules this module exists to enforce:

1. **Declared quality and live behaviour are separate claims.** A holdout F1 is
   what a model scored on a fixed set on one day; the confidence distribution in
   ``priority_results`` is what it is doing to production traffic right now.
   They are returned as distinct blocks so the UI can never present one as the
   other. A registry F1 with no matching rows in the corpus means "registered,
   not yet exercised" — not "performing well".

2. **Nothing is derived that was not measured.** Per-class precision/recall
   come from the evaluation row as recorded. Where a metric was not measured it
   stays ``None`` and the UI renders "not measured", rather than a zero that
   reads like a failing score.

Self-check: ``python -m app.services.model_review`` (run from app/backend).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AssistantInsight,
    Extraction,
    ModelEvaluation,
    ModelTrainingRun,
    ModelVersion,
    Post,
    PriorityResult,
    SentimentResult,
)

# A model version whose marker appears on zero posts has never scored a row in
# this corpus — the registry knows it, production has not seen it.
UNEXERCISED = "not_exercised"


# ---------------------------------------------------------------------------
# pure helpers (self-checked)
# ---------------------------------------------------------------------------
def confidence_bands(values: list[float]) -> dict[str, int]:
    """Bucket confidences into bands the UI can show as a distribution.

    Bands are chosen to answer "how much of production output is the model
    unsure about", which is the operational question — not to be pretty.
    """
    bands = {"very_high": 0, "high": 0, "medium": 0, "low": 0}
    for v in values:
        if v is None:
            continue
        if v >= 0.90:
            bands["very_high"] += 1
        elif v >= 0.75:
            bands["high"] += 1
        elif v >= 0.50:
            bands["medium"] += 1
        else:
            bands["low"] += 1
    return bands


def headline_metric(ev: dict | None) -> dict[str, Any]:
    """Pick the one number that belongs on a card, and SAY which one it is.

    An NER model has no accuracy; a classifier has no macro-F1 recorded here.
    Returning {value, label} instead of a bare float stops the UI from labelling
    a macro-F1 as "accuracy" — a real risk when one card template serves both.
    """
    if not ev:
        return {"value": None, "label": "not measured", "kind": None}
    if ev.get("accuracy") is not None:
        return {"value": ev["accuracy"], "label": "Holdout accuracy", "kind": "accuracy"}
    if ev.get("macro_f1") is not None:
        return {"value": ev["macro_f1"], "label": "Macro F1", "kind": "macro_f1"}
    per = ev.get("per_class") or {}
    f1s = [m.get("f1") for m in per.values() if isinstance(m, dict) and m.get("f1") is not None]
    if f1s:
        return {
            "value": sum(f1s) / len(f1s),
            "label": f"Mean F1 across {len(f1s)} labels",
            "kind": "mean_f1",
        }
    return {"value": None, "label": "not measured", "kind": None}


def weakest_class(per_class: dict) -> dict[str, Any] | None:
    """The label a reviewer should look at first.

    Ranks every class on ONE metric, chosen per evaluation rather than per
    class. Mixing bases is the bug this guards against: ranking class A's
    recall against class B's F1 makes "weakest" meaningless, and it silently
    picked the wrong label when one class happened to report recall and the
    others only reported F1.

    Preference order is F1 (balances both error directions), then recall, then
    precision — whichever ALL scored classes report.
    """
    rows = {l: m for l, m in (per_class or {}).items() if isinstance(m, dict)}
    if not rows:
        return None
    for basis in ("f1", "recall", "precision"):
        scored = {l: m[basis] for l, m in rows.items() if m.get(basis) is not None}
        # Only use a basis every class reports, so the comparison is like-for-like.
        if len(scored) == len(rows) and scored:
            label = min(scored, key=lambda l: scored[l])
            return {
                "label": label,
                "score": scored[label],
                "basis": basis,
                "support": rows[label].get("support"),
            }
    # No metric is shared by all classes — rank on the widest one available
    # and say which, rather than silently mixing.
    for basis in ("f1", "recall", "precision"):
        scored = {l: m[basis] for l, m in rows.items() if m.get(basis) is not None}
        if scored:
            label = min(scored, key=lambda l: scored[l])
            return {
                "label": label,
                "score": scored[label],
                "basis": basis,
                "support": rows[label].get("support"),
            }
    return None


def coverage_pct(scored: int, total: int) -> float | None:
    """Share of the corpus this model has actually scored. None when empty —
    0.0 would read as "scored nothing" even when there is nothing to score."""
    if not total:
        return None
    return scored / total


# ---------------------------------------------------------------------------
# DB assembly
# ---------------------------------------------------------------------------
def _row_to_dict(obj, fields: list[str]) -> dict:
    return {f: getattr(obj, f) for f in fields}


_EVAL_FIELDS = [
    "id", "eval_type", "eval_set_ref", "eval_rows", "evaluated_at", "accuracy",
    "macro_f1", "per_class", "confusion", "is_current", "git_commit", "doc_ref", "notes",
]
_RUN_FIELDS = [
    "id", "run_type", "label", "started_at", "finished_at", "duration_hours",
    "epochs", "final_loss", "hardware", "dataset_ref", "dataset", "hyperparams",
    "outcome", "outcome_reason", "git_commit", "git_subject", "git_committed_at",
    "log_path", "doc_ref", "notes",
]
_VERSION_FIELDS = [
    "id", "version", "display_name", "task", "base_model", "architecture",
    "param_count", "checkpoint_path", "serving_via", "stage", "provider",
    "license", "provenance_url", "notes", "active", "trained_at", "deployed_at",
    "retired_at", "training_set_ref", "git_commit", "git_subject", "git_author",
    "git_committed_at", "git_paths", "git_history", "hyperparams", "calibration",
    "labels",
]


async def _live_stats(session: AsyncSession, days: int) -> dict[str, Any]:
    """What each model is doing to the corpus right now (not what it scored)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    total_posts = await session.scalar(select(func.count()).select_from(Post)) or 0

    out: dict[str, Any] = {"total_posts": total_posts, "window_days": days}

    for key, model, col in (
        ("priority", PriorityResult, PriorityResult.priority),
        ("sentiment", SentimentResult, SentimentResult.sentiment),
    ):
        rows = (
            await session.execute(
                select(col, model.confidence, model.model_version)
            )
        ).all()
        dist: dict[str, int] = {}
        confs: list[float] = []
        versions: dict[str, int] = {}
        for label, conf, mv in rows:
            name = label.value if hasattr(label, "value") else str(label)
            dist[name] = dist.get(name, 0) + 1
            if conf is not None:
                confs.append(float(conf))
            versions[mv] = versions.get(mv, 0) + 1
        recent = await session.scalar(
            select(func.count()).select_from(model).where(model.created_at >= since)
        ) or 0
        scored = await session.scalar(
            select(func.count(func.distinct(model.post_id))).select_from(model)
        ) or 0
        out[key] = {
            "rows": len(rows),
            "posts_scored": scored,
            "coverage": coverage_pct(scored, total_posts),
            "distribution": dist,
            "confidence_bands": confidence_bands(confs),
            "mean_confidence": (sum(confs) / len(confs)) if confs else None,
            "model_versions_seen": versions,
            "rows_in_window": recent,
        }

    ent_rows = (
        await session.execute(
            select(Extraction.entity_label, func.count())
            .group_by(Extraction.entity_label)
            .order_by(func.count().desc())
        )
    ).all()
    ner_scored = await session.scalar(
        select(func.count(func.distinct(Extraction.post_id))).select_from(Extraction)
    ) or 0
    ner_conf = [
        float(c) for (c,) in
        (await session.execute(select(Extraction.confidence))).all()
        if c is not None
    ]
    ner_recent = await session.scalar(
        select(func.count()).select_from(Extraction).where(Extraction.created_at >= since)
    ) or 0
    out["ner"] = {
        "rows": sum(c for _, c in ent_rows),
        "posts_scored": ner_scored,
        "coverage": coverage_pct(ner_scored, total_posts),
        "distribution": {str(l): c for l, c in ent_rows},
        "confidence_bands": confidence_bands(ner_conf),
        "mean_confidence": (sum(ner_conf) / len(ner_conf)) if ner_conf else None,
        "rows_in_window": ner_recent,
        "note": (
            "Extractions have no per-post idempotency — one post is re-extracted "
            "on every analyze pass, so row count is not corpus volume. "
            "posts_scored is the distinct-post figure."
        ),
    }

    # The assistant produces insights, not per-post labels, so its "live" figure
    # is a different shape by nature — kept under the same key so the UI reads
    # one place, with distribution/confidence explicitly absent rather than 0.
    ins_rows = (
        await session.execute(
            select(AssistantInsight.status, func.count()).group_by(AssistantInsight.status)
        )
    ).all()
    ins_recent = await session.scalar(
        select(func.count()).select_from(AssistantInsight)
        .where(AssistantInsight.created_at >= since)
    ) or 0
    out["assistant"] = {
        "rows": sum(c for _, c in ins_rows),
        "posts_scored": None,
        "coverage": None,
        "distribution": {
            (s.value if hasattr(s, "value") else str(s)): c for s, c in ins_rows
        },
        "confidence_bands": None,
        "mean_confidence": None,
        "rows_in_window": ins_recent,
        "note": (
            "A generative model, not a classifier: it writes insights rather than "
            "labelling posts, so there is no per-post coverage or confidence "
            "distribution to report. Every insight shown passed the evidence gate."
        ),
    }
    return out


async def build_review(session: AsyncSession, days: int = 30) -> dict[str, Any]:
    versions = (
        await session.execute(
            select(ModelVersion).order_by(ModelVersion.kind, ModelVersion.id)
        )
    ).scalars().all()

    runs_by_version: dict[int, list[dict]] = {}
    for r in (await session.execute(select(ModelTrainingRun))).scalars().all():
        runs_by_version.setdefault(r.model_version_id, []).append(
            _row_to_dict(r, _RUN_FIELDS)
        )
    evals_by_version: dict[int, list[dict]] = {}
    for e in (await session.execute(select(ModelEvaluation))).scalars().all():
        evals_by_version.setdefault(e.model_version_id, []).append(
            _row_to_dict(e, _EVAL_FIELDS)
        )

    live = await _live_stats(session, days)

    models = []
    for v in versions:
        kind = v.kind.value if hasattr(v.kind, "value") else str(v.kind)
        evs = sorted(
            evals_by_version.get(v.id, []),
            key=lambda e: (e["is_current"], e["evaluated_at"] or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )
        current = next((e for e in evs if e["is_current"]), None)
        runs = sorted(
            runs_by_version.get(v.id, []),
            key=lambda r: (r["started_at"] or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )
        stats = live.get(kind)
        models.append({
            **_row_to_dict(v, _VERSION_FIELDS),
            "kind": kind,
            "headline": headline_metric(current),
            "weakest_class": weakest_class((current or {}).get("per_class") or {}),
            "current_evaluation": current,
            "evaluations": evs,
            "training_runs": runs,
            "run_counts": {
                "total": len(runs),
                "deployed": sum(1 for r in runs if r["outcome"] == "deployed"),
                "rejected": sum(1 for r in runs if r["outcome"] == "rejected"),
                "superseded": sum(1 for r in runs if r["outcome"] == "superseded"),
            },
            "live_stats": stats,
            "exercised": bool(stats and stats.get("rows")),
        })

    return {
        "generated_at": datetime.now(timezone.utc),
        "window_days": days,
        "corpus": {"total_posts": live["total_posts"]},
        "models": models,
        "summary": {
            "total_versions": len(models),
            "live": sum(1 for m in models if m["stage"] == "live"),
            "training_runs": sum(m["run_counts"]["total"] for m in models),
            "rejected_runs": sum(m["run_counts"]["rejected"] for m in models),
            "evaluations": sum(len(m["evaluations"]) for m in models),
        },
    }


# ---------------------------------------------------------------------------
def _self_check() -> None:
    assert confidence_bands([0.95, 0.8, 0.6, 0.2, None]) == {
        "very_high": 1, "high": 1, "medium": 1, "low": 1
    }
    assert confidence_bands([]) == {"very_high": 0, "high": 0, "medium": 0, "low": 0}
    # boundaries land in the higher band
    assert confidence_bands([0.90])["very_high"] == 1
    assert confidence_bands([0.75])["high"] == 1
    assert confidence_bands([0.50])["medium"] == 1

    # headline must name what it returns, never mislabel macro-F1 as accuracy
    assert headline_metric(None)["value"] is None
    assert headline_metric({"accuracy": 0.93})["kind"] == "accuracy"
    assert headline_metric({"macro_f1": 0.896})["kind"] == "macro_f1"
    m = headline_metric({"per_class": {"a": {"f1": 0.9}, "b": {"f1": 0.7}}})
    assert m["kind"] == "mean_f1" and abs(m["value"] - 0.8) < 1e-9
    assert headline_metric({"per_class": {"a": {"support": 3}}})["value"] is None

    # weakest class: one metric for ALL classes, never a mix of bases
    w = weakest_class({
        "low": {"recall": 0.98}, "high": {"recall": 0.50}, "medium": {"recall": 0.88}
    })
    assert w["label"] == "high" and w["basis"] == "recall"
    w2 = weakest_class({"person": {"f1": 0.97}, "components": {"f1": 0.84}})
    assert w2["label"] == "components" and w2["basis"] == "f1"
    # Regression guard (real GLiNER data): ai_hub reports recall 0.84 AND f1
    # 0.91; components reports only f1 0.84. Ranking ai_hub's recall against
    # components' f1 wrongly flagged ai_hub. F1 is shared by both, so on F1
    # components (0.84) is genuinely the weakest and must win.
    w3 = weakest_class({
        "ssd": {"f1": 0.92},
        "ai_hub": {"f1": 0.91, "recall": 0.84, "precision": 1.0},
        "components": {"f1": 0.84},
    })
    assert w3["label"] == "components", f"mixed bases picked {w3['label']}"
    assert w3["basis"] == "f1"
    # F1 is preferred even when every class also reports recall
    w4 = weakest_class({"a": {"f1": 0.9, "recall": 0.2}, "b": {"f1": 0.5, "recall": 0.99}})
    assert w4["label"] == "b" and w4["basis"] == "f1"
    # No shared metric: still returns something, and names the basis used
    w5 = weakest_class({"a": {"recall": 0.4}, "b": {"precision": 0.9}})
    assert w5 is not None and w5["basis"] in ("recall", "precision")
    assert weakest_class({}) is None
    assert weakest_class({"x": "not a dict"}) is None

    # coverage: empty corpus is unknown, not zero
    assert coverage_pct(0, 0) is None
    assert coverage_pct(5223, 5223) == 1.0
    assert abs(coverage_pct(50, 200) - 0.25) < 1e-9

    print("model_review self-check OK")


if __name__ == "__main__":
    _self_check()

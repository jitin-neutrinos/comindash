"""Live intelligence for the Metrics page (/api/metrics/intel).

The trends endpoint answers "what are the numbers?". A metrics *explorer*
should answer the question a reader actually arrives with: **is this normal,
and if not, what changed?** A line going up means nothing without a baseline;
a top-10 entity list means nothing without knowing which of those are rising.

So this module computes, per metric, the things a chart cannot show on its own:

1. **Anomalies** — days whose value sits more than N robust deviations from
   the window's own centre. Robust (median + MAD), not mean + stdev, because
   a single 3x spike day drags a mean so hard it hides every other spike.

2. **Change point** — the day the series best splits into "before" and
   "after". Answers "when did this start?", which is the first question asked
   of any trend that has moved.

3. **Movers** — for entities and categorical mixes: what is rising or falling
   between the first and second half of the window, by rate, not raw count,
   so a small-but-doubling entity is not buried under a large flat one.

4. **Composition drift** — for sentiment/priority: how the *mix* shifted, not
   just the totals. A window with flat volume but negativity moving 18%→31%
   is the interesting case and a total-count chart hides it completely.

5. **Weekday/quality profile** — when the community posts, and how confident
   the models are on this slice, so a reader can discount a shaky number.

Everything is measured from the same rows the chart renders. Nothing is
generated here; the narrative lives in ``metrics_brief`` and is labelled.

Self-check (pure functions, no DB): ``python -m app.services.metrics_intel``
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Extraction,
    Post,
    Priority,
    PriorityResult,
    Sentiment,
    SentimentResult,
    Topic,
)
from app.services.relationship_graph import NON_ENTITY_LABELS, PRODUCT_NAMES

# A day must exceed this many robust deviations from the median to be called
# an anomaly. 3.5 is the conventional modified-z threshold; below it, normal
# weekday rhythm on a forum this size starts producing false alarms.
ANOMALY_Z = 3.5

# 0.6745 is the 0.75 quantile of the standard normal — it rescales MAD so the
# resulting score is comparable to a standard z-score.
MAD_SCALE = 0.6745

# A series shorter than this cannot support a change-point claim.
MIN_CHANGEPOINT_POINTS = 8

# An entity must clear this many mentions before its growth rate is reported;
# 1 -> 3 mentions is +200% and means nothing.
MIN_MOVER_MENTIONS = 4


# --- pure helpers (unit-checkable) -------------------------------------------


def modified_z(values: Sequence[float]) -> list[float]:
    """Robust z-scores via median + MAD.

    Returns zeros when the data cannot support a spread estimate (fewer than
    3 points, or MAD of 0 with no usable fallback) — saying "no anomalies"
    is correct there; inventing infinities is not.
    """
    n = len(values)
    if n < 3:
        return [0.0] * n
    med = statistics.median(values)
    deviations = [abs(v - med) for v in values]
    mad = statistics.median(deviations)
    if mad == 0:
        # All-identical or near-identical series: fall back to mean absolute
        # deviation so a lone spike in an otherwise flat series is still seen.
        mean_ad = sum(deviations) / n
        if mean_ad == 0:
            return [0.0] * n
        return [(v - med) / (1.253314 * mean_ad) for v in values]
    return [MAD_SCALE * (v - med) / mad for v in values]


def find_anomalies(
    dates: Sequence[str], values: Sequence[float], threshold: float = ANOMALY_Z
) -> list[dict]:
    """Days whose value is a robust outlier, strongest first."""
    scores = modified_z(values)
    med = statistics.median(values) if values else 0.0
    out = [
        {
            "date": dates[i],
            "value": values[i],
            "score": round(scores[i], 2),
            "direction": "spike" if scores[i] > 0 else "drop",
            "vs_typical": round(values[i] - med, 2),
        }
        for i in range(len(values))
        if abs(scores[i]) >= threshold
    ]
    out.sort(key=lambda a: -abs(a["score"]))
    return out[:5]


def find_change_point(values: Sequence[float]) -> int | None:
    """Index where the series best splits into two different levels.

    Maximises the weighted squared difference between the two halves' means —
    the standard single-shift detector. Returns None when the series is too
    short to support the claim.
    """
    n = len(values)
    if n < MIN_CHANGEPOINT_POINTS:
        return None
    best_idx, best_score = None, 0.0
    # Leave at least 3 points either side so a single edge point cannot be
    # declared a regime change.
    for i in range(3, n - 2):
        left, right = values[:i], values[i:]
        gap = statistics.fmean(right) - statistics.fmean(left)
        # Weight by segment sizes: a shift supported by more data matters more.
        score = (len(left) * len(right) / n) * gap * gap
        if score > best_score:
            best_idx, best_score = i, score
    return best_idx


def split_rates(values: Sequence[float]) -> tuple[float, float, float | None]:
    """(first-half rate, second-half rate, relative change).

    Rates so unequal halves compare fairly. Relative change is None against a
    zero baseline — an undefined ratio is reported as undefined, not infinity.
    """
    n = len(values)
    if n < 2:
        return (0.0, 0.0, None)
    mid = n // 2
    first = statistics.fmean(values[:mid]) if values[:mid] else 0.0
    second = statistics.fmean(values[mid:]) if values[mid:] else 0.0
    if first == 0:
        return (first, second, None)
    return (first, second, round((second - first) / first, 4))


def rank_movers(
    first: dict[str, float], second: dict[str, float], min_count: float = MIN_MOVER_MENTIONS
) -> tuple[list[dict], list[dict]]:
    """(risers, fallers) between two halves of a window.

    Keys below `min_count` in BOTH halves are dropped: their percentage change
    is dominated by noise. New keys (absent in the first half) are reported as
    new rather than as an infinite increase.
    """
    keys = set(first) | set(second)
    rows = []
    for k in keys:
        a, b = first.get(k, 0.0), second.get(k, 0.0)
        if max(a, b) < min_count:
            continue
        if a == 0:
            rows.append({"key": k, "before": a, "after": b, "change": None, "status": "new"})
        elif b == 0:
            rows.append({"key": k, "before": a, "after": b, "change": -1.0, "status": "gone"})
        else:
            rows.append(
                {
                    "key": k,
                    "before": a,
                    "after": b,
                    "change": round((b - a) / a, 4),
                    "status": "changed",
                }
            )
    risers = sorted(
        [r for r in rows if r["status"] == "new" or (r["change"] or 0) > 0.15],
        key=lambda r: (-(r["after"]), r["key"]),
    )[:5]
    fallers = sorted(
        [r for r in rows if r["status"] == "gone" or (r["change"] or 0) < -0.15],
        key=lambda r: (r["change"] if r["change"] is not None else -1, r["key"]),
    )[:5]
    return risers, fallers


def share(part: float, whole: float) -> float:
    return round(part / whole, 4) if whole else 0.0


def _self_check() -> None:
    # --- modified_z ---
    assert modified_z([]) == []
    assert modified_z([1.0, 2.0]) == [0.0, 0.0], "too short for a spread estimate"
    flat = modified_z([5.0] * 6)
    assert all(z == 0.0 for z in flat), flat
    # a lone spike in a flat series must still be detected via the fallback
    spiked = modified_z([5, 5, 5, 5, 5, 40])
    assert spiked[-1] > 3.5, spiked
    # symmetric data -> the extreme ends carry the largest magnitudes
    z = modified_z([10, 11, 10, 11, 10, 60])
    assert z[-1] == max(z), z

    # --- anomalies ---
    dates = [f"2026-09-{d:02d}" for d in range(1, 8)]
    vals = [10, 11, 10, 12, 10, 11, 90]
    found = find_anomalies(dates, vals)
    assert len(found) == 1, found
    assert found[0]["date"] == "2026-09-07" and found[0]["direction"] == "spike"
    assert found[0]["vs_typical"] > 0
    assert find_anomalies(dates, [10] * 7) == [], "flat series has no anomalies"

    # --- change point ---
    assert find_change_point([1, 2, 3]) is None, "too short"
    step = [2, 2, 3, 2, 2, 20, 21, 19, 20, 21]
    cp = find_change_point(step)
    assert cp == 5, cp
    # a pure-noise series must not produce a confident split at the edges
    cp2 = find_change_point([5, 5, 5, 5, 5, 5, 5, 5, 5, 5])
    assert cp2 is None or 3 <= cp2 <= 7, cp2

    # --- split rates ---
    first, second, chg = split_rates([2, 2, 2, 4, 4, 4])
    assert first == 2 and second == 4 and chg == 1.0, (first, second, chg)
    assert split_rates([0, 0, 5, 5])[2] is None, "zero baseline -> undefined"
    assert split_rates([1])[2] is None

    # --- movers ---
    risers, fallers = rank_movers(
        {"alpha": 10, "reels": 4, "noise": 1},
        {"alpha": 30, "reels": 1, "studio": 12, "noise": 2},
    )
    rk = {r["key"] for r in risers}
    fk = {f["key"] for f in fallers}
    assert "alpha" in rk and "studio" in rk, rk
    assert "reels" in fk, fk
    assert "noise" not in rk | fk, "sub-threshold keys must be dropped"
    assert next(r for r in risers if r["key"] == "studio")["status"] == "new"
    assert next(r for r in risers if r["key"] == "alpha")["change"] == 2.0

    assert share(1, 4) == 0.25 and share(1, 0) == 0.0

    print("metrics_intel self-check OK")


# --- DB-backed assembly -------------------------------------------------------


@dataclass
class _Window:
    start: date
    days: int


def _daily_map(rows) -> dict[str, float]:
    return {str(d): float(n) for d, n in rows}


def _fill_days(by_day: dict[str, float], start: date, days: int) -> tuple[list[str], list[float]]:
    """Dense daily series — missing days are real zeros, not gaps to skip.

    Dropping empty days would make a quiet week look like continuous activity
    and silently distort every rate computed downstream.
    """
    dates, values = [], []
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        dates.append(d)
        values.append(by_day.get(d, 0.0))
    return dates, values


async def _volume_intel(session: AsyncSession, w: _Window) -> dict:
    cutoff = datetime.combine(w.start, datetime.min.time(), tzinfo=timezone.utc)
    rows = await session.execute(
        select(func.date(Post.created_at), func.count())
        .where(Post.created_at >= cutoff)
        .group_by(func.date(Post.created_at))
    )
    dates, values = _fill_days(_daily_map(rows.all()), w.start, w.days)
    first, second, change = split_rates(values)
    cp = find_change_point(values)

    # Weekday profile: which days the community actually posts on.
    weekday_totals = [0.0] * 7
    weekday_counts = [0] * 7
    for i, d in enumerate(dates):
        wd = date.fromisoformat(d).weekday()
        weekday_totals[wd] += values[i]
        weekday_counts[wd] += 1
    weekday = [
        {
            "day": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
            "avg": round(weekday_totals[i] / weekday_counts[i], 2) if weekday_counts[i] else 0.0,
        }
        for i in range(7)
    ]

    # Topic concentration: is discussion spread out, or piling into a few threads?
    topic_rows = await session.execute(
        select(Topic.title, func.count(Post.id))
        .join(Post, Post.topic_id == Topic.id)
        .where(Post.created_at >= cutoff)
        .group_by(Topic.title)
        .order_by(func.count(Post.id).desc())
        .limit(5)
    )
    top_topics = [{"label": t or "Untitled", "count": int(n)} for t, n in topic_rows.all()]
    total = sum(values)

    authors = await session.scalar(
        select(func.count(func.distinct(Post.author_hash))).where(Post.created_at >= cutoff)
    )

    return {
        "metric": "volume",
        "series": [{"date": dates[i], "value": values[i]} for i in range(len(dates))],
        "total": total,
        "daily_avg": round(total / w.days, 2) if w.days else 0.0,
        "peak": {"date": dates[values.index(max(values))], "value": max(values)} if values else None,
        "quiet_days": sum(1 for v in values if v == 0),
        "first_half_rate": round(first, 2),
        "second_half_rate": round(second, 2),
        "change": change,
        "change_point": {"index": cp, "date": dates[cp]} if cp is not None else None,
        "anomalies": find_anomalies(dates, values),
        "weekday": weekday,
        "top_topics": top_topics,
        "top_topic_share": share(top_topics[0]["count"], total) if top_topics else 0.0,
        "active_authors": int(authors or 0),
    }


async def _sentiment_intel(session: AsyncSession, w: _Window) -> dict:
    cutoff = datetime.combine(w.start, datetime.min.time(), tzinfo=timezone.utc)
    rows = await session.execute(
        select(
            func.date(Post.created_at),
            SentimentResult.sentiment,
            func.count(),
            func.avg(SentimentResult.confidence),
        )
        .join(Post, Post.id == SentimentResult.post_id)
        .where(Post.created_at >= cutoff)
        .group_by(func.date(Post.created_at), SentimentResult.sentiment)
    )
    per_day: dict[str, dict[str, float]] = {}
    conf_sum, conf_n = 0.0, 0
    for d, sentiment, n, conf in rows.all():
        b = per_day.setdefault(str(d), {"pos": 0.0, "neu": 0.0, "neg": 0.0})
        b[sentiment.value] += float(n)
        conf_sum += (conf or 0.0) * n
        conf_n += n

    dates = [(w.start + timedelta(days=i)).isoformat() for i in range(w.days)]
    series = []
    neg_share_series = []
    for d in dates:
        b = per_day.get(d, {"pos": 0.0, "neu": 0.0, "neg": 0.0})
        tot = b["pos"] + b["neu"] + b["neg"]
        series.append({"date": d, **b, "total": tot})
        neg_share_series.append(share(b["neg"], tot) if tot else 0.0)

    totals = {k: sum(s[k] for s in series) for k in ("pos", "neu", "neg")}
    grand = sum(totals.values())
    mid = len(series) // 2

    def half_share(rows_, key):
        t = sum(r["pos"] + r["neu"] + r["neg"] for r in rows_)
        return share(sum(r[key] for r in rows_), t)

    drift = {
        k: {
            "before": half_share(series[:mid], k),
            "after": half_share(series[mid:], k),
        }
        for k in ("pos", "neu", "neg")
    }
    for k, v in drift.items():
        v["delta"] = round(v["after"] - v["before"], 4)

    # Anomalies on negative SHARE, not on negative count: a busy day naturally
    # has more negative posts, and flagging that would just re-detect volume.
    labelled = [i for i, s in enumerate(series) if s["total"] >= 3]
    anomalies = []
    if len(labelled) >= 3:
        sub_dates = [dates[i] for i in labelled]
        sub_vals = [neg_share_series[i] for i in labelled]
        anomalies = find_anomalies(sub_dates, sub_vals)

    return {
        "metric": "sentiment",
        "series": series,
        "totals": totals,
        "shares": {k: share(v, grand) for k, v in totals.items()},
        "labelled_posts": grand,
        "drift": drift,
        "anomalies": anomalies,
        "avg_confidence": round(conf_sum / conf_n, 4) if conf_n else 0.0,
        "worst_day": (
            max(
                ({"date": dates[i], "neg_share": neg_share_series[i]} for i in labelled),
                key=lambda x: x["neg_share"],
            )
            if labelled
            else None
        ),
    }


async def _priority_intel(session: AsyncSession, w: _Window) -> dict:
    cutoff = datetime.combine(w.start, datetime.min.time(), tzinfo=timezone.utc)
    rows = await session.execute(
        select(
            func.date(Post.created_at),
            PriorityResult.priority,
            func.count(),
            func.avg(PriorityResult.confidence),
        )
        .join(Post, Post.id == PriorityResult.post_id)
        .where(Post.created_at >= cutoff)
        .group_by(func.date(Post.created_at), PriorityResult.priority)
    )
    per_day: dict[str, dict[str, float]] = {}
    conf_sum, conf_n = 0.0, 0
    for d, priority, n, conf in rows.all():
        b = per_day.setdefault(str(d), {"high": 0.0, "medium": 0.0, "low": 0.0})
        b[priority.value] += float(n)
        conf_sum += (conf or 0.0) * n
        conf_n += n

    dates = [(w.start + timedelta(days=i)).isoformat() for i in range(w.days)]
    series = []
    high_share_series = []
    for d in dates:
        b = per_day.get(d, {"high": 0.0, "medium": 0.0, "low": 0.0})
        tot = b["high"] + b["medium"] + b["low"]
        series.append({"date": d, **b, "total": tot})
        high_share_series.append(share(b["high"], tot) if tot else 0.0)

    totals = {k: sum(s[k] for s in series) for k in ("high", "medium", "low")}
    grand = sum(totals.values())
    mid = len(series) // 2

    def half_share(rows_, key):
        t = sum(r["high"] + r["medium"] + r["low"] for r in rows_)
        return share(sum(r[key] for r in rows_), t)

    drift = {}
    for k in ("high", "medium", "low"):
        before, after = half_share(series[:mid], k), half_share(series[mid:], k)
        drift[k] = {"before": before, "after": after, "delta": round(after - before, 4)}

    labelled = [i for i, s in enumerate(series) if s["total"] >= 3]
    anomalies = []
    if len(labelled) >= 3:
        anomalies = find_anomalies(
            [dates[i] for i in labelled], [high_share_series[i] for i in labelled]
        )

    # Which topics carry the high-priority load — where the backlog actually is.
    hot = await session.execute(
        select(Topic.title, func.count(PriorityResult.id))
        .join(Post, Post.id == PriorityResult.post_id)
        .join(Topic, Topic.id == Post.topic_id)
        .where(Post.created_at >= cutoff, PriorityResult.priority == Priority.high)
        .group_by(Topic.title)
        .order_by(func.count(PriorityResult.id).desc())
        .limit(5)
    )

    return {
        "metric": "priority",
        "series": series,
        "totals": totals,
        "shares": {k: share(v, grand) for k, v in totals.items()},
        "labelled_posts": grand,
        "drift": drift,
        "anomalies": anomalies,
        "avg_confidence": round(conf_sum / conf_n, 4) if conf_n else 0.0,
        "hot_topics": [{"label": t or "Untitled", "count": int(n)} for t, n in hot.all()],
    }


async def _entity_intel(session: AsyncSession, w: _Window) -> dict:
    cutoff = datetime.combine(w.start, datetime.min.time(), tzinfo=timezone.utc)
    mid_day = w.start + timedelta(days=w.days // 2)
    mid_dt = datetime.combine(mid_day, datetime.min.time(), tzinfo=timezone.utc)

    async def counts(lo, hi=None):
        q = (
            select(Extraction.entity_text, Extraction.entity_label, func.count(func.distinct(Post.id)))
            .join(Post, Post.id == Extraction.post_id)
            .where(Post.created_at >= lo)
            .group_by(Extraction.entity_text, Extraction.entity_label)
        )
        if hi is not None:
            q = q.where(Post.created_at < hi)
        return (await session.execute(q)).all()

    first_rows = await counts(cutoff, mid_dt)
    second_rows = await counts(mid_dt)

    def fold(rows):
        out: dict[str, float] = {}
        labels: dict[str, str] = {}
        for text, label, n in rows:
            if label in NON_ENTITY_LABELS:
                continue
            key = f"{label}:{(text or '').strip().casefold()[:48]}"
            out[key] = out.get(key, 0.0) + float(n)
            labels[key] = (text or "").strip()[:48]
        return out, labels

    first, l1 = fold(first_rows)
    second, l2 = fold(second_rows)
    names = {**l1, **l2}
    risers, fallers = rank_movers(first, second)
    for r in risers + fallers:
        r["label"] = names.get(r["key"], r["key"])
        r["category"] = r["key"].split(":", 1)[0]

    combined: dict[str, float] = dict(first)
    for k, v in second.items():
        combined[k] = combined.get(k, 0.0) + v
    top = sorted(combined.items(), key=lambda kv: -kv[1])[:12]

    by_category: dict[str, float] = {}
    for k, v in combined.items():
        by_category[k.split(":", 1)[0]] = by_category.get(k.split(":", 1)[0], 0.0) + v

    total_mentions = sum(combined.values())
    product_mentions = sum(v for k, v in by_category.items() if k in PRODUCT_NAMES)

    return {
        "metric": "entity",
        # Entity mentions have no daily series, so there is no day-level outlier
        # to detect. The key is present-and-empty so every metric answers the
        # same shape and no caller has to special-case its absence.
        "anomalies": [],
        "change_point": None,
        "top": [
            {
                "key": k,
                "label": names.get(k, k),
                "category": k.split(":", 1)[0],
                "count": v,
                "share": share(v, total_mentions),
            }
            for k, v in top
        ],
        "by_category": [
            {"label": k, "count": v, "share": share(v, total_mentions)}
            for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])[:10]
        ],
        "risers": risers,
        "fallers": fallers,
        "distinct_entities": len(combined),
        "total_mentions": total_mentions,
        "product_share": share(product_mentions, total_mentions),
    }


_BUILDERS = {
    "volume": _volume_intel,
    "sentiment": _sentiment_intel,
    "priority": _priority_intel,
    "entity": _entity_intel,
}


async def load_metric_intel(session: AsyncSession, metric: str, days: int = 30) -> dict:
    """Measured intelligence for one metric over one window."""
    if metric not in _BUILDERS:
        raise ValueError(f"unknown metric {metric!r}")
    today = datetime.now(timezone.utc).date()
    w = _Window(start=today - timedelta(days=days - 1), days=days)
    payload = await _BUILDERS[metric](session, w)
    payload["window"] = {
        "days": days,
        "start": w.start.isoformat(),
        "end": today.isoformat(),
    }
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    return payload


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

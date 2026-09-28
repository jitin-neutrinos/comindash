"""Live intelligence layer for /api/insights/intel.

The nightly analyst writes a *static* conclusion: a title, a body and some
evidence, frozen at the moment the cycle ran. That answers "what did we
conclude?" but never "is it still true, is it getting worse, and how much of
the community does it actually explain?" — which is what a reader on an
insights page is really asking.

This module answers those questions by measuring the live corpus underneath
each insight, with no model call involved:

1. **Subjects** — which products and people an insight is actually about.
   Resolved from three independent sources and unioned: product names written
   in the title/body, the analyst's own asserted relationship endpoints, and
   the entities NER extracted from the insight's evidence posts.

2. **Scope** — the set of posts an insight covers. With two or more product
   subjects the *intersection* is used (an insight about "Reels + Alpha
   integration" is about posts naming both, not either), falling back to the
   union when the intersection is too thin to measure. The mode is reported so
   the UI can say which it is instead of implying precision it does not have.

3. **Momentum** — the scope's posting rate over a recent window against the
   baseline window before it. This is the number that turns a frozen
   conclusion into a live one: an insight whose scope has gone quiet is
   cooling whatever its severity says.

4. **Signal series** — weekly volume / negative-sentiment / high-priority
   counts across the scope, for the sparkline and the detail charts.

5. **Lineage** — how many cycles have re-raised the same insight and whether
   its severity has moved, read from the superseded rows the gate leaves
   behind.

6. **Coverage** — the share of recent posts that at least one active insight
   explains. The honest answer to "are we looking at the whole picture?"

Everything here is measured. Nothing is generated. The generated narrative
lives in ``insight_brief`` and is clearly labelled as such.

Self-check (pure functions, no DB): ``python -m app.services.insight_intel``
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AssistantInsight,
    Extraction,
    InsightEvidence,
    InsightRelationship,
    InsightStatus,
    Post,
    Priority,
    PriorityResult,
    Sentiment,
    SentimentResult,
    Topic,
)
from app.services.analysis.glm_client import PRODUCT_GLOSSARY
from app.services.slugs import insight_slug
from app.services.relationship_graph import (
    NON_ENTITY_LABELS,
    PRODUCT_NAMES,
    person_key,
    pick_display_name,
    product_key,
)

# Windows. Recent is deliberately short (the forum posts ~60-120/week, so two
# weeks is a real sample) and the baseline is twice as long so a single quiet
# week cannot flip an insight's state on its own.
RECENT_DAYS = 14
BASELINE_DAYS = 28

# A narrowing step is only taken when it leaves at least this many posts —
# below it the measurement stops meaning anything, so the step is declined.
MIN_SCOPE_POSTS = 8

# Cap on how many of an insight's own words are used to narrow its scope.
MAX_NARROW_TERMS = 6

# Momentum thresholds on the rate delta. Chosen so week-to-week noise at this
# forum's volume (±20% is normal) does not read as a trend.
SURGE_DELTA = 0.60
RISE_DELTA = 0.20
COOL_DELTA = -0.20

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}


# --- pure helpers (unit-checkable) -------------------------------------------


@dataclass
class Momentum:
    """Recent posting rate against the preceding baseline rate."""

    state: str = "dormant"
    delta_pct: float | None = None
    recent_posts: int = 0
    baseline_posts: int = 0
    recent_rate: float = 0.0
    baseline_rate: float = 0.0

    def as_dict(self) -> dict:
        return {
            "state": self.state,
            "delta_pct": self.delta_pct,
            "recent_posts": self.recent_posts,
            "baseline_posts": self.baseline_posts,
            "recent_rate": round(self.recent_rate, 3),
            "baseline_rate": round(self.baseline_rate, 3),
            "recent_days": RECENT_DAYS,
            "baseline_days": BASELINE_DAYS,
        }


def compute_momentum(recent_posts: int, baseline_posts: int) -> Momentum:
    """Classify a scope's direction from two post counts.

    Rates, not raw counts, because the windows are different lengths. A scope
    with no recent activity at all is ``dormant`` regardless of history — the
    conclusion may still be true, but nothing is currently driving it.
    """
    recent_rate = recent_posts / RECENT_DAYS
    baseline_rate = baseline_posts / BASELINE_DAYS
    m = Momentum(
        recent_posts=recent_posts,
        baseline_posts=baseline_posts,
        recent_rate=recent_rate,
        baseline_rate=baseline_rate,
    )
    if recent_posts == 0:
        m.state = "dormant"
        m.delta_pct = -1.0 if baseline_posts else None
        return m
    if baseline_rate == 0:
        # Nothing before, something now: genuinely new activity, but a delta
        # against zero is undefined — say "new" rather than invent an infinity.
        m.state = "new"
        m.delta_pct = None
        return m

    delta = (recent_rate - baseline_rate) / baseline_rate
    m.delta_pct = round(delta, 4)
    if delta >= SURGE_DELTA:
        m.state = "surging"
    elif delta >= RISE_DELTA:
        m.state = "rising"
    elif delta <= COOL_DELTA:
        m.state = "cooling"
    else:
        m.state = "steady"
    return m


def week_start(d: date) -> date:
    """Monday of d's week — weekly buckets read far better than daily noise."""
    return d - timedelta(days=d.weekday())


def weekly_series(
    post_dates: dict[int, date],
    post_ids: set[int],
    neg_ids: set[int],
    high_ids: set[int],
    weeks: int,
    today: date,
) -> list[dict]:
    """Volume / negative / high-priority counts per week, oldest first.

    Weeks with no posts are emitted as zeros so the sparkline shows a real gap
    instead of silently compressing time.
    """
    end = week_start(today)
    buckets = [end - timedelta(weeks=i) for i in range(weeks - 1, -1, -1)]
    index = {w: i for i, w in enumerate(buckets)}
    vol = [0] * weeks
    neg = [0] * weeks
    high = [0] * weeks
    for pid in post_ids:
        d = post_dates.get(pid)
        if d is None:
            continue
        i = index.get(week_start(d))
        if i is None:
            continue
        vol[i] += 1
        if pid in neg_ids:
            neg[i] += 1
        if pid in high_ids:
            high[i] += 1
    return [
        {
            "week": buckets[i].isoformat(),
            "posts": vol[i],
            "negative": neg[i],
            "high": high[i],
        }
        for i in range(weeks)
    ]


def _word_re(term: str) -> re.Pattern:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", re.I)


_PRODUCT_PATTERNS: list[tuple[str, re.Pattern]] = []
for _label, _name in PRODUCT_NAMES.items():
    # Match the display name ("Alpha Platform"), the bare key ("alpha"), and
    # the key with spaces ("identity server") — real titles use all three.
    _terms = {_name, _label, _label.replace("_", " ")}
    # The first word of a two-word product name ("Alpha" of "Alpha Platform")
    # is how posts and titles actually refer to it.
    if " " in _name:
        _terms.add(_name.split()[0])
    for _t in _terms:
        if len(_t) >= 3:
            _PRODUCT_PATTERNS.append((_label, _word_re(_t)))


def products_in_text(text: str) -> set[str]:
    """Product entity labels named anywhere in a piece of free text."""
    if not text:
        return set()
    return {label for label, pat in _PRODUCT_PATTERNS if pat.search(text)}


# Words that must never be used to narrow a scope: ordinary English, analyst
# vocabulary that appears in every insight title, and the product names
# themselves (a product term matches every post about that product, which
# narrows nothing and defeats the purpose).
_STOPWORDS = {
    "this", "that", "with", "from", "have", "has", "been", "were", "was", "are",
    "their", "there", "these", "those", "than", "then", "them", "they", "when",
    "where", "which", "while", "what", "into", "over", "under", "after",
    "before", "does", "doing", "done", "must", "will", "would", "should",
    "could", "make", "makes", "made", "need", "needs", "needed", "used",
    "using", "user", "users", "issue", "issues", "problem", "problems",
    "recurring", "repeated", "multiple", "several", "common", "across",
    "without", "within", "about", "because", "cause", "causes", "caused",
    "still", "more", "most", "many", "some", "only", "also", "each", "every",
    "high", "medium", "low", "priority", "sentiment", "severity", "insight",
    "insights", "community", "forum", "post", "posts", "thread", "threads",
    "team", "teams", "customer", "customers", "support", "platform",
    "service", "services", "system", "systems", "feature", "features",
    "change", "changes", "update", "updates", "release", "releases",
    "version", "versions", "error", "errors", "failure", "failures",
    "drive", "drives", "driven", "signals", "indicates", "shows", "showing",
}
_PRODUCT_WORDS = {
    w
    for label, name in PRODUCT_NAMES.items()
    for w in {label, *label.split("_"), *name.casefold().split()}
    if len(w) >= 4
}


def resolve_subjects(
    title: str,
    body: str,
    asserted_values: list[str],
    evidence_entities: Counter,
) -> tuple[list[str], list[str]]:
    """(product keys, person keys) an insight is about.

    Three sources, unioned, in descending order of reliability: entities NER
    actually found in the evidence posts, the analyst's own relationship
    endpoints, and product names written in the prose. Prose alone is the
    weakest signal, so it only contributes products (never people — a name in
    a sentence is not a measurable entity).
    """
    products: set[str] = set()
    people: set[str] = set()

    for key, _n in evidence_entities.most_common():
        if key.startswith("product:"):
            products.add(key)
        elif key.startswith("person:"):
            people.add(key)

    for value in asserted_values:
        v = (value or "").strip()
        if not v:
            continue
        folded = v.casefold().replace(" ", "_")
        if folded in PRODUCT_NAMES:
            products.add(product_key(folded))
            continue
        hits = products_in_text(v)
        if hits:
            products |= {product_key(h) for h in hits}
        elif person_key(v) in evidence_entities:
            people.add(person_key(v))

    products |= {product_key(p) for p in products_in_text(f"{title}\n{body}")}

    # Order products by how strongly the evidence supports them, then by name,
    # so the chip row is stable across reloads.
    ordered_products = sorted(
        products, key=lambda k: (-evidence_entities.get(k, 0), k)
    )
    ordered_people = sorted(people, key=lambda k: (-evidence_entities.get(k, 0), k))
    return ordered_products, ordered_people


def choose_scope(
    subject_posts: list[set[int]], min_scope: int = MIN_SCOPE_POSTS
) -> tuple[set[int], str]:
    """Post set for an insight, plus the mode used to derive it.

    **Greedy narrowing, never union.** Subjects arrive strongest-evidence
    first. Start from the strongest subject's posts, then intersect with each
    next subject only while the result stays above ``min_scope``; a subject
    that would collapse the scope is skipped rather than allowed to widen it.

    Union is deliberately not an option. Unioning a rare subject (Reels Engine,
    4 posts) with a common one (Alpha, 757) produces a set that is *larger*
    than either — the opposite of narrowing — and an insight measured that way
    reports a third of the forum as its scope. Skipping the subject we cannot
    afford to intersect on is the honest answer: the scope stays the posts we
    can actually defend, and ``mode`` says how many subjects it used.
    """
    sets = [s for s in subject_posts if s]
    if not sets:
        return set(), "none"
    scope = set(sets[0])
    used = 1
    for nxt in sets[1:]:
        candidate = scope & nxt
        if len(candidate) >= min_scope:
            scope = candidate
            used += 1
    if used == 1:
        return scope, "single" if len(sets) == 1 else "broad"
    return scope, "narrowed"


def distinctive_terms(title: str, body: str = "") -> list[str]:
    """Technical terms from an insight's own words, for text narrowing.

    An insight like "Stale jBPM async jobs..." is about a *concept* NER never
    extracts, so its only resolvable subject is the product (Alpha) and its
    scope is every Alpha post. The insight's own title names the thing though
    — 'jBPM', 'archival', 'validations' — and those terms are searchable in
    post bodies. Product names and ordinary English are excluded: they would
    match everything and narrow nothing.
    """
    words = re.findall(r"[A-Za-z][A-Za-z0-9_.-]{3,}", f"{title} {body}")
    seen: dict[str, None] = {}
    for w in words:
        folded = w.casefold().strip(".-_")
        if len(folded) < 4 or folded in _STOPWORDS or folded in _PRODUCT_WORDS:
            continue
        seen.setdefault(folded, None)
    # Title terms carry more signal than body terms and come first already;
    # cap so one verbose insight cannot match half the forum.
    return list(seen)[:MAX_NARROW_TERMS]


def narrow_by_terms(
    scope: set[int], term_hits: set[int], min_scope: int = MIN_SCOPE_POSTS
) -> tuple[set[int], bool]:
    """Intersect a scope with posts matching the insight's own terms.

    Applied only when it leaves a measurable scope — a narrowing that empties
    the set tells us nothing, so it is declined and reported as not applied.
    """
    if not term_hits:
        return scope, False
    candidate = scope & term_hits
    if len(candidate) >= min_scope:
        return candidate, True
    return scope, False



def coverage_ratio(covered: set[int], universe: set[int]) -> float:
    if not universe:
        return 0.0
    return round(len(covered & universe) / len(universe), 4)


def _self_check() -> None:
    # --- momentum ---
    m = compute_momentum(recent_posts=40, baseline_posts=40)
    # 40/14 = 2.857 vs 40/28 = 1.428 -> +100% -> surging
    assert m.state == "surging", m
    assert abs(m.delta_pct - 1.0) < 1e-6, m.delta_pct

    assert compute_momentum(20, 40).state == "steady", compute_momentum(20, 40)
    assert compute_momentum(10, 40).state == "cooling"
    assert compute_momentum(0, 40).state == "dormant"
    assert compute_momentum(0, 40).delta_pct == -1.0
    assert compute_momentum(5, 0).state == "new"
    assert compute_momentum(5, 0).delta_pct is None
    assert compute_momentum(0, 0).state == "dormant"
    assert compute_momentum(0, 0).delta_pct is None
    # 26/14 = 1.857 vs 40/28 = 1.428 -> +30% -> rising
    assert compute_momentum(26, 40).state == "rising", compute_momentum(26, 40)

    # --- weekly buckets ---
    today = date(2026, 9, 28)  # a Monday
    assert week_start(today) == date(2026, 9, 28)
    assert week_start(date(2026, 9, 27)) == date(2026, 9, 21)
    dates = {
        1: date(2026, 9, 28),
        2: date(2026, 9, 24),
        3: date(2026, 9, 24),
        4: date(2020, 1, 1),  # out of window -> dropped
    }
    s = weekly_series(dates, {1, 2, 3, 4}, {2}, {3}, weeks=3, today=today)
    assert len(s) == 3
    assert s[-1]["posts"] == 1 and s[-1]["week"] == "2026-09-28"
    assert s[-2]["posts"] == 2 and s[-2]["negative"] == 1 and s[-2]["high"] == 1
    assert s[0]["posts"] == 0

    # --- product detection ---
    assert "alpha" in products_in_text("Alpha Platform BPM archival is broken")
    assert "alpha" in products_in_text("a bug in Alpha's workflow")
    assert "reels" in products_in_text("Reels-Alpha integration")
    assert "identity_server" in products_in_text("Identity Server token expiry")
    assert "ai_hub" in products_in_text("AI Hub batch API")
    # must not fire on a substring inside another word
    assert "alpha" not in products_in_text("alphabetical ordering of columns")
    assert "ssd" not in products_in_text("the sssd daemon")

    # --- subject resolution ---
    ev = Counter({product_key("reels"): 5, person_key("sam"): 3})
    prods, people = resolve_subjects(
        "Reels-Alpha BPM integration is a recurring blocker",
        "work item handler failures",
        ["Alpha Platform", "Sam"],
        ev,
    )
    assert product_key("reels") in prods and product_key("alpha") in prods, prods
    assert people == [person_key("sam")], people
    # evidence-backed product ranks ahead of prose-only product
    assert prods[0] == product_key("reels"), prods

    # --- scope: greedy narrowing, never union ---
    # Strongest subject first; each next subject narrows only if it can.
    scope, mode = choose_scope([{1, 2, 3}, {3, 4, 5}], min_scope=1)
    assert scope == {3} and mode == "narrowed", (scope, mode)
    # The second subject would collapse the scope below the floor -> skipped,
    # and the scope must NOT grow to the union.
    scope, mode = choose_scope([{1, 2, 3}, {3, 4, 5}], min_scope=2)
    assert scope == {1, 2, 3} and mode == "broad", (scope, mode)
    assert len(scope) <= 3, "narrowing must never widen a scope"
    # Three subjects, middle one affordable, last one not.
    scope, mode = choose_scope([{1, 2, 3, 4}, {2, 3, 4, 9}, {4}], min_scope=2)
    assert scope == {2, 3, 4} and mode == "narrowed", (scope, mode)
    assert choose_scope([{1, 2}])[1] == "single"
    assert choose_scope([])[1] == "none"
    assert choose_scope([set(), set()])[1] == "none"

    # --- term extraction ---
    terms = distinctive_terms(
        "Stale jBPM async jobs caused two production incidents", ""
    )
    assert "jbpm" in terms, terms
    assert "async" in terms, terms
    # analyst boilerplate and product names must never become narrowing terms
    assert "recurring" not in terms and "issues" not in terms
    assert "alpha" not in distinctive_terms("Alpha Platform validation bug")
    assert "platform" not in distinctive_terms("Alpha Platform validation bug")
    assert len(distinctive_terms(" ".join(f"term{i}" for i in range(40)))) <= (
        MAX_NARROW_TERMS
    )

    # --- term narrowing ---
    narrowed, applied = narrow_by_terms({1, 2, 3, 4}, {2, 3}, min_scope=2)
    assert narrowed == {2, 3} and applied is True
    # would leave too little -> declined, scope unchanged
    narrowed, applied = narrow_by_terms({1, 2, 3, 4}, {2}, min_scope=2)
    assert narrowed == {1, 2, 3, 4} and applied is False
    narrowed, applied = narrow_by_terms({1, 2}, set(), min_scope=1)
    assert narrowed == {1, 2} and applied is False

    assert coverage_ratio({1, 2, 9}, {1, 2, 3, 4}) == 0.5
    assert coverage_ratio(set(), set()) == 0.0

    print("insight_intel self-check OK")


# --- DB-backed assembly -------------------------------------------------------


@dataclass
class _Corpus:
    """Everything the intel pass needs, loaded once for all insights."""

    post_dates: dict[int, date] = field(default_factory=dict)
    posts_by_product: dict[str, set[int]] = field(default_factory=dict)
    posts_by_person: dict[str, set[int]] = field(default_factory=dict)
    person_labels: dict[str, str] = field(default_factory=dict)
    mentions: Counter = field(default_factory=Counter)
    entities_by_post: dict[int, set[str]] = field(default_factory=dict)
    neg_ids: set[int] = field(default_factory=set)
    high_ids: set[int] = field(default_factory=set)
    recent_ids: set[int] = field(default_factory=set)
    baseline_ids: set[int] = field(default_factory=set)
    window_ids: set[int] = field(default_factory=set)
    total_posts: int = 0


async def _load_corpus(session: AsyncSession, days: int, today: date) -> _Corpus:
    c = _Corpus()

    rows = (await session.execute(select(Post.id, Post.created_at))).all()
    recent_cut = today - timedelta(days=RECENT_DAYS)
    baseline_cut = today - timedelta(days=RECENT_DAYS + BASELINE_DAYS)
    window_cut = today - timedelta(days=days)
    for pid, created in rows:
        if created is None:
            continue
        d = created.date()
        c.post_dates[pid] = d
        if d > recent_cut:
            c.recent_ids.add(pid)
        elif d > baseline_cut:
            c.baseline_ids.add(pid)
        if d > window_cut:
            c.window_ids.add(pid)
    c.total_posts = len(rows)

    ext = (
        await session.execute(
            select(Extraction.post_id, Extraction.entity_label, Extraction.entity_text)
        )
    ).all()
    variants: dict[str, Counter] = defaultdict(Counter)
    for pid, label, text in ext:
        if label in NON_ENTITY_LABELS:
            continue
        if label == "person":
            t = (text or "").strip()
            if not t:
                continue
            key = person_key(t)
            variants[key][t] += 1
            c.posts_by_person.setdefault(key, set()).add(pid)
        else:
            key = product_key(label)
            c.posts_by_product.setdefault(key, set()).add(pid)
        c.entities_by_post.setdefault(pid, set()).add(key)
    for key, counter in variants.items():
        c.person_labels[key] = pick_display_name(counter) or key.split(":", 1)[1]
    # Mention weight counts posts, not raw rows — extractions have no per-post
    # idempotency, so a re-analysed post would otherwise count many times.
    for key, pids in {**c.posts_by_product, **c.posts_by_person}.items():
        c.mentions[key] = len(pids)

    # Latest label per post (re-analysis can leave more than one row).
    prio = select(
        PriorityResult.post_id.label("post_id"),
        PriorityResult.priority.label("priority"),
        func.row_number()
        .over(
            partition_by=PriorityResult.post_id,
            order_by=PriorityResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    c.high_ids = {
        r[0]
        for r in (
            await session.execute(
                select(prio.c.post_id).where(
                    prio.c.rn == 1, prio.c.priority == Priority.high
                )
            )
        ).all()
    }

    sent = select(
        SentimentResult.post_id.label("post_id"),
        SentimentResult.sentiment.label("sentiment"),
        func.row_number()
        .over(
            partition_by=SentimentResult.post_id,
            order_by=SentimentResult.created_at.desc(),
        )
        .label("rn"),
    ).subquery()
    c.neg_ids = {
        r[0]
        for r in (
            await session.execute(
                select(sent.c.post_id).where(
                    sent.c.rn == 1, sent.c.sentiment == Sentiment.neg
                )
            )
        ).all()
    }
    return c


def _subject_out(key: str, corpus: _Corpus) -> dict:
    kind, _, value = key.partition(":")
    if kind == "product":
        return {
            "key": key,
            "kind": "product",
            "label": PRODUCT_NAMES.get(value, value.replace("_", " ").title()),
            "description": PRODUCT_GLOSSARY.get(value, ""),
            "posts": corpus.mentions.get(key, 0),
        }
    return {
        "key": key,
        "kind": "person",
        "label": corpus.person_labels.get(key, value),
        "description": "",
        "posts": corpus.mentions.get(key, 0),
    }


async def _term_hits(session: AsyncSession, terms: list[str]) -> set[int]:
    """Post ids whose body contains ANY of the insight's distinctive terms.

    ILIKE on a substring cannot use the btree index, so this is a sequential
    scan — acceptable because it runs for at most a handful of active
    insights per request and the corpus is ~5K rows. If the corpus grows past
    a few hundred thousand posts, move this to a tsvector GIN index.
    """
    if not terms:
        return set()
    clauses = [Post.body_text.ilike(f"%{t}%") for t in terms]
    rows = await session.execute(select(Post.id).where(or_(*clauses)))
    return {r[0] for r in rows.all()}


async def _resolve_scope(
    session: AsyncSession,
    ins: AssistantInsight,
    corpus: _Corpus,
    ev_posts: list[int],
    asserted_values: list[str],
) -> tuple[set[int], str, list[str], bool]:
    """(scope, mode, subject keys, term-narrowing applied) for one insight.

    Single source of truth for what an insight covers — ``load_intel`` and
    ``scope_posts`` both call this so the panel's numbers and the panel's
    posts can never describe different sets.
    """
    ev_entities: Counter = Counter()
    for pid in ev_posts:
        for key in corpus.entities_by_post.get(pid, ()):
            ev_entities[key] += 1

    products, people = resolve_subjects(
        ins.title, ins.body, asserted_values, ev_entities
    )
    subject_keys = products + people
    subject_sets = [
        corpus.posts_by_product.get(k) or corpus.posts_by_person.get(k) or set()
        for k in subject_keys
    ]
    scope, mode = choose_scope(subject_sets)

    # An insight whose subjects are one common product covers that product's
    # whole footprint — too broad to mean anything. Its own words are the only
    # remaining signal, so narrow with them when they leave a measurable set.
    narrowed = False
    if mode in {"single", "broad"} and len(scope) > MIN_SCOPE_POSTS * 4:
        terms = distinctive_terms(ins.title, ins.body)
        scope, narrowed = narrow_by_terms(
            scope, await _term_hits(session, terms), MIN_SCOPE_POSTS
        )

    # Evidence posts belong to the scope by definition — the analyst cited
    # them for this insight.
    scope |= set(ev_posts)
    return scope, ("focused" if narrowed else mode), subject_keys, narrowed


async def _insight_rows(session: AsyncSession) -> list[AssistantInsight]:
    return list(
        (
            await session.execute(
                select(AssistantInsight).order_by(AssistantInsight.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def load_intel(session: AsyncSession, days: int = 90) -> dict:
    """Every active insight, enriched with live measurements, plus a rollup."""
    today = datetime.now(timezone.utc).date()
    corpus = await _load_corpus(session, days, today)
    all_insights = await _insight_rows(session)
    active = [i for i in all_insights if i.status == InsightStatus.active]
    active_ids = [i.id for i in active]

    # Evidence -> post ids, per insight (one query for all of them).
    evidence: dict[int, list[int]] = defaultdict(list)
    if active_ids:
        for iid, pid in (
            await session.execute(
                select(InsightEvidence.insight_id, InsightEvidence.post_id).where(
                    InsightEvidence.insight_id.in_(active_ids)
                )
            )
        ).all():
            evidence[iid].append(pid)

    asserted: dict[int, list[tuple[str, str, str]]] = defaultdict(list)
    if active_ids:
        for iid, subj, rel, obj in (
            await session.execute(
                select(
                    InsightRelationship.insight_id,
                    InsightRelationship.subject_value,
                    InsightRelationship.relation,
                    InsightRelationship.object_value,
                ).where(InsightRelationship.insight_id.in_(active_ids))
            )
        ).all():
            asserted[iid].append((subj, rel, obj))

    # Lineage: superseded rows sharing type+title are earlier raisings of the
    # same conclusion — the gate supersedes on exactly that pair.
    history: dict[tuple[str, str], list[AssistantInsight]] = defaultdict(list)
    for row in all_insights:
        history[(row.insight_type.value, row.title)].append(row)

    weeks = max(4, min(26, days // 7))
    items: list[dict] = []
    covered: set[int] = set()

    for ins in active:
        ev_posts = evidence.get(ins.id, [])
        asserted_values: list[str] = []
        for subj, _rel, obj in asserted.get(ins.id, []):
            asserted_values.extend([subj, obj])

        scope, scope_mode, subject_keys, narrowed = await _resolve_scope(
            session, ins, corpus, ev_posts, asserted_values
        )
        covered |= scope

        momentum = compute_momentum(
            recent_posts=len(scope & corpus.recent_ids),
            baseline_posts=len(scope & corpus.baseline_ids),
        )
        series = weekly_series(
            corpus.post_dates, scope, corpus.neg_ids, corpus.high_ids, weeks, today
        )

        in_window = scope & corpus.window_ids
        neg_in_scope = len(scope & corpus.neg_ids)
        high_in_scope = len(scope & corpus.high_ids)
        last_post = max(
            (corpus.post_dates[p] for p in scope if p in corpus.post_dates),
            default=None,
        )

        lineage_rows = sorted(
            history.get((ins.insight_type.value, ins.title), []),
            key=lambda r: r.created_at,
        )
        severities = [r.severity for r in lineage_rows]
        severity_changed = len(set(severities)) > 1
        first_seen = lineage_rows[0].created_at if lineage_rows else ins.created_at

        items.append(
            {
                "id": ins.id,
                "slug": insight_slug(ins.id, ins.title),
                "insight_type": ins.insight_type.value,
                "title": ins.title,
                "body": ins.body,
                "severity": ins.severity,
                "status": ins.status.value,
                "assistant_version": ins.assistant_version,
                "created_at": ins.created_at.isoformat() if ins.created_at else None,
                "first_seen": first_seen.isoformat() if first_seen else None,
                "evidence_count": len(ev_posts),
                "subjects": [_subject_out(k, corpus) for k in subject_keys[:6]],
                "scope": {
                    "posts": len(scope),
                    "mode": scope_mode,
                    "term_narrowed": narrowed,
                    "posts_in_window": len(in_window),
                    "negative_posts": neg_in_scope,
                    "high_priority_posts": high_in_scope,
                    "negative_share": round(neg_in_scope / len(scope), 4)
                    if scope
                    else 0.0,
                    "corpus_share": round(len(scope) / corpus.total_posts, 4)
                    if corpus.total_posts
                    else 0.0,
                    "last_post": last_post.isoformat() if last_post else None,
                    "days_since_last_post": (today - last_post).days
                    if last_post
                    else None,
                },
                "momentum": momentum.as_dict(),
                "series": series,
                "lineage": {
                    "cycles": len(lineage_rows),
                    "severity_changed": severity_changed,
                    "severity_history": severities,
                    "first_seen": first_seen.isoformat() if first_seen else None,
                },
                "relations": [
                    {"subject": s, "relation": r, "object": o}
                    for s, r, o in asserted.get(ins.id, [])
                ],
            }
        )

    # Cross-links: insights sharing a subject key.
    by_subject: dict[str, list[int]] = defaultdict(list)
    for it in items:
        for s in it["subjects"]:
            by_subject[s["key"]].append(it["id"])
    titles = {it["id"]: it["title"] for it in items}
    types = {it["id"]: it["insight_type"] for it in items}
    for it in items:
        related: dict[int, set[str]] = defaultdict(set)
        for s in it["subjects"]:
            for other in by_subject[s["key"]]:
                if other != it["id"]:
                    related[other].add(s["label"])
        it["related"] = sorted(
            (
                {
                    "id": rid,
                    "title": titles[rid],
                    "insight_type": types[rid],
                    "shared": sorted(labels),
                }
                for rid, labels in related.items()
            ),
            key=lambda r: -len(r["shared"]),
        )[:4]

    items.sort(
        key=lambda i: (
            SEVERITY_RANK.get(i["severity"], 3),
            -(i["momentum"]["recent_posts"]),
        )
    )

    by_state: Counter = Counter(i["momentum"]["state"] for i in items)
    by_type: Counter = Counter(i["insight_type"] for i in items)
    by_severity: Counter = Counter(i["severity"] for i in items)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_days": days,
        "items": items,
        "rollup": {
            "active": len(items),
            "by_state": dict(by_state),
            "by_type": dict(by_type),
            "by_severity": dict(by_severity),
            "coverage": coverage_ratio(covered, corpus.window_ids),
            "covered_posts": len(covered & corpus.window_ids),
            "window_posts": len(corpus.window_ids),
            "total_posts": corpus.total_posts,
            "recent_posts": len(corpus.recent_ids),
            "recent_negative": len(corpus.recent_ids & corpus.neg_ids),
            "recent_high": len(corpus.recent_ids & corpus.high_ids),
            "superseded": sum(
                1 for i in await _insight_rows(session) if i.status.value == "superseded"
            ),
            "recent_days": RECENT_DAYS,
            "baseline_days": BASELINE_DAYS,
        },
    }


async def scope_posts(
    session: AsyncSession, insight_id: int, limit: int = 8, days: int = 90
) -> list[dict]:
    """Newest posts inside one insight's scope — the live evidence, not the
    frozen evidence rows the analyst picked at write time."""
    today = datetime.now(timezone.utc).date()
    corpus = await _load_corpus(session, days, today)
    ins = await session.get(AssistantInsight, insight_id)
    if ins is None:
        return []

    ev_posts = [
        r[0]
        for r in (
            await session.execute(
                select(InsightEvidence.post_id).where(
                    InsightEvidence.insight_id == insight_id
                )
            )
        ).all()
    ]
    asserted_values: list[str] = []
    for subj, obj in (
        await session.execute(
            select(
                InsightRelationship.subject_value, InsightRelationship.object_value
            ).where(InsightRelationship.insight_id == insight_id)
        )
    ).all():
        asserted_values.extend([subj, obj])

    scope, _mode, _subjects, _narrowed = await _resolve_scope(
        session, ins, corpus, ev_posts, asserted_values
    )
    if not scope:
        return []

    # Pick the newest ids in Python before querying. Slicing the raw set would
    # hand the DB an arbitrary subset (sets have no order), so the "newest
    # posts in scope" could silently exclude the actual newest ones.
    newest = sorted(
        (p for p in scope if p in corpus.post_dates),
        key=lambda p: corpus.post_dates[p],
        reverse=True,
    )[:limit]
    if not newest:
        return []

    rows = (
        await session.execute(
            select(
                Post.id,
                Post.body_text,
                Post.discourse_post_id,
                Post.created_at,
                Topic.title,
                Topic.slug,
                Topic.discourse_topic_id,
            )
            .join(Topic, Topic.id == Post.topic_id, isouter=True)
            .where(Post.id.in_(newest))
            .order_by(Post.created_at.desc().nullslast())
        )
    ).all()
    ev_set = set(ev_posts)
    return [
        {
            "post_id": pid,
            "discourse_post_id": dpid,
            "topic": title or "",
            "slug": slug or "",
            "topic_id": tdid,
            "created_at": created.isoformat() if created else None,
            "excerpt": (body or "").strip()[:320],
            "is_evidence": pid in ev_set,
            "negative": pid in corpus.neg_ids,
            "high_priority": pid in corpus.high_ids,
        }
        for pid, body, dpid, created, title, slug, tdid in rows
    ]


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

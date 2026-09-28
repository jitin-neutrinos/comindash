"""Verify the relationships an insight *claims* against the corpus.

The assistant writes relationship rows like::

    alpha --has_production_risk_in--> jBPM async job replay   strength 0.9

Three things are wrong with showing that to a reader as-is. The relation is a
raw model token, not English. The "strength" is the model's own self-report --
unfalsifiable, and 0.9 looks like a measurement while being an opinion. And the
`evidence_ids` column is empty for every row we have, so the claim points at
nothing.

This module answers the question the reader actually has: *is that true?* It
resolves both endpoints onto things that genuinely exist in the corpus, counts
the posts where they really do appear together, compares that against what
random chance would produce, and hands back the posts so the reader can check
the work. A claim we cannot support is labelled as such rather than dressed up
in a confidence score.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Extraction, Post, Topic
from app.models import InsightRelationship
from app.services.relationship_graph import (
    NON_ENTITY_LABELS,
    PRODUCT_NAMES,
    person_key,
    pick_display_name,
    product_key,
)

# A claim needs this many co-occurring posts before we call it supported. Two
# posts is an anecdote; three is the smallest number that can show a pattern.
MIN_SUPPORT_POSTS = 3
# Observed overlap must beat chance by this much. Two very common things
# co-occur constantly without being related -- lift is what separates
# "Alpha and Sam are connected" from "Alpha and Sam are both everywhere".
MIN_LIFT = 1.3
# Evidence lists are for reading, not for exhaustiveness.
MAX_EVIDENCE = 6

# Relation tokens the assistant emits, in the analyst's own voice. Anything not
# listed falls back to a de-underscored form, so a new token degrades to
# readable English instead of breaking.
_RELATION_PHRASES = {
    "has_production_risk_in": "carries production risk in",
    "data_corruption_risk_in": "risks data corruption in",
    "validation_gap_in": "has a validation gap in",
    "integration_blocker_with": "is blocked integrating with",
    "upgrade_friction_for": "creates upgrade friction for",
    "primary_support_owner_of": "is the main support owner for",
    "environment_parity_pain_in": "suffers environment parity pain in",
    "startup_failure_from": "fails to start because of",
    "performance_guidance_needed_for": "needs performance guidance for",
    "depends_on": "depends on",
    "blocks": "blocks",
    "causes": "causes",
    "affects": "affects",
    "owns": "owns",
    "related_to": "is related to",
}

# Words too common to identify anything. Kept deliberately small: this list
# only has to survive contact with short relationship endpoint phrases, not
# whole post bodies.
_PHRASE_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "that", "this", "when",
    "where", "which", "their", "there", "been", "were", "was", "are", "has",
    "have", "had", "its", "our", "your", "all", "any", "new", "use", "used",
    "using", "via", "per", "per-", "out", "off", "onto", "over", "under",
    "issue", "issues", "problem", "problems", "error", "errors", "setup",
    "configuration", "config", "support", "platform", "service", "services",
    "calls", "call", "page", "pages", "job", "jobs", "case", "cases",
    "management", "deployment", "deployments", "submission", "form", "forms",
}


def humanize_relation(token: str) -> str:
    """`has_production_risk_in` -> `carries production risk in`."""
    t = (token or "").strip()
    if not t:
        return "is related to"
    return _RELATION_PHRASES.get(t, t.replace("_", " ").strip())


def _word_re(term: str) -> re.Pattern:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", re.I)


def phrase_terms(value: str) -> list[str]:
    """Distinctive words of an endpoint phrase, longest first.

    Length is only a fallback ordering for callers without corpus counts;
    `_match_by_text` re-orders by true rarity once it can measure it.
    """
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", value or "")
    out = [w for w in words if w.casefold() not in _PHRASE_STOPWORDS]
    return sorted(out, key=len, reverse=True)


@dataclass
class _Endpoint:
    """One side of a claim, resolved onto real posts."""

    kind: str = "concept"  # product | person | concept
    label: str = ""
    raw: str = ""
    posts: set[int] = field(default_factory=set)
    matched_on: str = ""  # how we found it, shown to the reader
    resolved: bool = False


@dataclass
class _Index:
    """Corpus lookups shared by every claim on the page."""

    posts_by_product: dict[str, set[int]] = field(default_factory=dict)
    posts_by_person: dict[str, set[int]] = field(default_factory=dict)
    person_labels: dict[str, str] = field(default_factory=dict)
    text_by_post: dict[int, str] = field(default_factory=dict)
    total_posts: int = 0


async def _load_index(session: AsyncSession) -> _Index:
    ix = _Index()

    rows = (await session.execute(select(Post.id, Post.body_text))).all()
    for pid, body in rows:
        ix.text_by_post[pid] = body or ""
    ix.total_posts = len(rows)

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
            ix.posts_by_person.setdefault(key, set()).add(pid)
        else:
            ix.posts_by_product.setdefault(product_key(label), set()).add(pid)
    for key, counter in variants.items():
        ix.person_labels[key] = pick_display_name(counter)
    return ix


def _match_by_text(terms: list[str], ix: _Index) -> tuple[set[int], str]:
    """Posts matching an endpoint phrase, narrowed while evidence survives.

    Terms are seeded by *measured* rarity, not by word length. 'jBPM async job
    replay' is the cautionary case: 'replay' is the longest surviving word but
    appears in 1 post, while 'jBPM' appears in 104 — seeding on length pinned
    the whole claim to a single post and made a real relationship look absent.

    A term matching nothing is skipped rather than allowed to zero the result:
    the analyst's phrasing need not match the community's wording exactly.
    """
    if not terms:
        return set(), ""

    hits_by_term: list[tuple[str, set[int]]] = []
    for term in terms[:6]:
        pat = _word_re(term)
        hits = {pid for pid, txt in ix.text_by_post.items() if pat.search(txt)}
        if hits:
            hits_by_term.append((term, hits))
    if not hits_by_term:
        return set(), ""

    # Prefer the rarest term that can still support a claim. A term appearing
    # in fewer than MIN_SUPPORT_POSTS posts is too rare to be a pattern -- it
    # anchors the whole scope to noise -- so those are only a last resort.
    usable = [kv for kv in hits_by_term if len(kv[1]) >= MIN_SUPPORT_POSTS]
    ranked = sorted(usable or hits_by_term, key=lambda kv: len(kv[1]))
    matched, used = set(ranked[0][1]), [ranked[0][0]]
    for term, hits in ranked[1:]:
        narrowed = matched & hits
        if len(narrowed) >= MIN_SUPPORT_POSTS:
            matched, used = narrowed, [*used, term]
    return matched, " + ".join(used)


def resolve_endpoint(value: str, type_hint: str, ix: _Index) -> _Endpoint:
    """Map one side of a claim onto posts that actually exist."""
    raw = (value or "").strip()
    ep = _Endpoint(raw=raw, label=raw or "unknown")
    if not raw:
        return ep
    folded = raw.casefold()

    # 1. A named product, by label or display name.
    for label, name in PRODUCT_NAMES.items():
        if folded in {label, label.replace("_", " "), name.casefold()} or (
            " " in name and folded == name.split()[0].casefold()
        ):
            key = product_key(label)
            if key in ix.posts_by_product:
                ep.kind = "product"
                ep.label = name
                ep.posts = ix.posts_by_product[key]
                ep.matched_on = "tagged product"
                ep.resolved = True
                return ep

    # 2. A known person.
    pkey = person_key(raw)
    if pkey in ix.posts_by_person:
        ep.kind = "person"
        ep.label = ix.person_labels.get(pkey, raw)
        ep.posts = ix.posts_by_person[pkey]
        ep.matched_on = "tagged person"
        ep.resolved = True
        return ep

    # 3. Free text: a topic or a symptom. Match it in post bodies.
    posts, used = _match_by_text(phrase_terms(raw), ix)
    ep.kind = "topic" if type_hint == "topic" else "concept"
    ep.posts = posts
    ep.matched_on = f"text: {used}" if used else ""
    ep.resolved = bool(posts)
    return ep


def assess(subject: _Endpoint, obj: _Endpoint, total: int) -> dict:
    """Does the corpus support this claim?

    Lift compares the overlap we see against the overlap two unrelated things
    of these sizes would produce by chance. Below ~1 the pairing is weaker than
    coincidence; well above it, something real connects them.
    """
    both = subject.posts & obj.posts
    observed = len(both)
    expected = (len(subject.posts) * len(obj.posts) / total) if total else 0.0
    lift = (observed / expected) if expected > 0 else None

    if not subject.resolved or not obj.resolved:
        verdict = "unverifiable"
    elif observed >= MIN_SUPPORT_POSTS and (lift is None or lift >= MIN_LIFT):
        verdict = "supported"
    elif observed > 0:
        verdict = "thin"
    else:
        verdict = "unsupported"

    return {
        "verdict": verdict,
        "co_occurring_posts": observed,
        "subject_posts": len(subject.posts),
        "object_posts": len(obj.posts),
        "expected_by_chance": round(expected, 2),
        "lift": round(lift, 2) if lift is not None else None,
        "overlap_ids": both,
    }


async def _evidence(
    session: AsyncSession, post_ids: set[int], limit: int = MAX_EVIDENCE
) -> list[dict]:
    """Newest co-occurring posts, with everything needed to link out."""
    if not post_ids:
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
            .where(Post.id.in_(post_ids))
            .order_by(Post.created_at.desc().nullslast())
            .limit(limit)
        )
    ).all()
    return [
        {
            "post_id": pid,
            "discourse_post_id": dpid,
            "topic": title or "",
            "slug": slug or "",
            "topic_id": tdid,
            "created_at": created.isoformat() if created else None,
            "excerpt": (body or "").strip()[:280],
        }
        for pid, body, dpid, created, title, slug, tdid in rows
    ]


async def check_claims(session: AsyncSession, insight_id: int) -> dict:
    """Every relationship this insight asserts, checked against the corpus."""
    rels = (
        await session.execute(
            select(InsightRelationship)
            .where(InsightRelationship.insight_id == insight_id)
            .order_by(InsightRelationship.strength.desc())
        )
    ).scalars().all()

    if not rels:
        return {"insight_id": insight_id, "claims": [], "summary": _summary([])}

    ix = await _load_index(session)
    claims: list[dict] = []
    for r in rels:
        subject = resolve_endpoint(r.subject_value, r.subject_type, ix)
        obj = resolve_endpoint(r.object_value, r.object_type, ix)
        verdict = assess(subject, obj, ix.total_posts)
        overlap = verdict.pop("overlap_ids")
        claims.append(
            {
                "id": r.id,
                "subject": {
                    "label": subject.label,
                    "kind": subject.kind,
                    "raw": subject.raw,
                    "posts": len(subject.posts),
                    "matched_on": subject.matched_on,
                    "resolved": subject.resolved,
                },
                "relation": humanize_relation(r.relation),
                "relation_token": r.relation,
                "object": {
                    "label": obj.label,
                    "kind": obj.kind,
                    "raw": obj.raw,
                    "posts": len(obj.posts),
                    "matched_on": obj.matched_on,
                    "resolved": obj.resolved,
                },
                # The assistant's own confidence, kept but clearly labelled as
                # an opinion so it is never mistaken for the measurement.
                "asserted_confidence": round(float(r.strength or 0.0), 2),
                **verdict,
                "evidence": await _evidence(session, overlap),
            }
        )

    return {
        "insight_id": insight_id,
        "corpus_posts": ix.total_posts,
        "claims": claims,
        "summary": _summary(claims),
    }


def _summary(claims: list[dict]) -> dict:
    counts = Counter(c["verdict"] for c in claims)
    return {
        "total": len(claims),
        "supported": counts.get("supported", 0),
        "thin": counts.get("thin", 0),
        "unsupported": counts.get("unsupported", 0),
        "unverifiable": counts.get("unverifiable", 0),
    }


def _self_check() -> None:
    assert humanize_relation("has_production_risk_in") == "carries production risk in"
    assert humanize_relation("some_new_token") == "some new token"
    assert humanize_relation("") == "is related to"

    # Distinctive terms drop filler and lead with the longest (most
    # informative) word; "job" is stopworded, "jBPM" must survive.
    terms = phrase_terms("jBPM async job replay")
    assert "job" not in terms, terms
    assert terms == ["replay", "async", "jBPM"], terms

    ix = _Index(total_posts=100)
    ix.posts_by_product = {"product:alpha": {1, 2, 3, 4, 5}}
    ix.posts_by_person = {"person:sam": {4, 5, 6}}
    ix.person_labels = {"person:sam": "Sam"}
    ix.text_by_post = {
        1: "async replay of the queue failed",
        2: "async replay again",
        3: "async replay once more",
        4: "unrelated chatter",
        5: "alpha notes",
        6: "sam replied",
    }

    alpha = resolve_endpoint("alpha", "entity", ix)
    assert alpha.resolved and alpha.kind == "product", alpha
    assert alpha.label == "Alpha Platform", alpha.label

    sam = resolve_endpoint("Sam", "entity", ix)
    assert sam.resolved and sam.kind == "person" and sam.label == "Sam", sam

    topic = resolve_endpoint("async replay", "topic", ix)
    assert topic.resolved and topic.posts == {1, 2, 3}, topic
    assert topic.matched_on.startswith("text:"), topic.matched_on

    # Regression: seed on measured rarity, not word length. 'replay' is the
    # longer word but hits 1 post; 'jBPM' hits 3. Length-first ordering pinned
    # the claim to a single post and made a real relationship look absent.
    rare = _Index(total_posts=100)
    rare.text_by_post = {
        1: "jBPM queue stalled",
        2: "jBPM retry failed",
        3: "jBPM scheduler note",
        4: "replay of the batch",
    }
    ep = resolve_endpoint("jBPM async job replay", "topic", rare)
    assert ep.posts == {1, 2, 3}, ep.posts
    assert ep.matched_on == "text: jBPM", ep.matched_on

    missing = resolve_endpoint("nothing matches here", "topic", ix)
    assert not missing.resolved and missing.posts == set(), missing

    # alpha{1..5} vs async{1,2,3}: 3 shared, chance would give 0.15 -> supported
    v = assess(alpha, topic, ix.total_posts)
    assert v["verdict"] == "supported", v
    assert v["co_occurring_posts"] == 3, v
    assert v["lift"] and v["lift"] > 10, v

    # An unresolvable endpoint can never be "supported" on a real measurement.
    v2 = assess(alpha, missing, ix.total_posts)
    assert v2["verdict"] == "unverifiable", v2
    assert v2["co_occurring_posts"] == 0, v2

    # Overlap that exists but is too small to be a pattern reads as thin.
    thin_a = _Endpoint(posts={1, 2}, resolved=True)
    thin_b = _Endpoint(posts={2, 3}, resolved=True)
    v3 = assess(thin_a, thin_b, 100)
    assert v3["verdict"] == "thin", v3

    # Two things that are everywhere must NOT read as supported on volume
    # alone: chance already explains the overlap.
    big_a = _Endpoint(posts=set(range(0, 80)), resolved=True)
    big_b = _Endpoint(posts=set(range(20, 100)), resolved=True)
    v4 = assess(big_a, big_b, 100)
    assert v4["lift"] is not None and v4["lift"] < MIN_LIFT, v4
    assert v4["verdict"] == "thin", v4

    s = _summary([{"verdict": "supported"}, {"verdict": "thin"}, {"verdict": "thin"}])
    assert s == {
        "total": 3,
        "supported": 1,
        "thin": 2,
        "unsupported": 0,
        "unverifiable": 0,
    }, s

    print("claim_check self-check OK")


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

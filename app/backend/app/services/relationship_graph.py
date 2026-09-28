"""Knowledge graph for /api/relationships.

Two layers, deliberately kept distinct because they answer different questions:

1. **Observed layer** (statistical, from `extractions`): who and what actually
   appear together in the same post. Nodes are people and Neutrinos products;
   edge weight is the number of distinct posts the pair co-occurs in. This is
   derived live from the NER corpus, so it always reflects whatever checkpoint
   last re-scored the posts — no separate refresh path to forget.

2. **Reasoned layer** (semantic, from `insight_relationships`): the named
   relations the GLM analyst asserted, each tied to an insight and its evidence.

Product identity is the entity *label* (canonical: `alpha`, `studio`), never the
surface text — real posts write "Alpha"/"alpha"/"alpha-pt" for one product.
Person identity is the casefolded surface text with the most common casing kept
for display.

Self-check: ``python -m app.services.relationship_graph`` (pure functions only,
no DB needed).
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AssistantInsight, Extraction, InsightRelationship, Post, Topic

# Products get a human display name; the glossary blurb comes from the same
# source the GLM analyst is grounded in, so the panel and the model agree.
from app.services.analysis.glm_client import PRODUCT_GLOSSARY

PRODUCT_NAMES = {
    "alpha": "Alpha Platform",
    "trinity": "Trinity",
    "pulse": "Pulse",
    "reels": "Reels",
    "reels_engine": "Reels Engine",
    "workbench": "Workbench",
    "ssd": "Server Services Designer",
    "csd": "Client Services Designer",
    "ai_hub": "AI Hub",
    "studio": "Neutrinos Studio",
    "hypha": "Hypha",
    "identity_server": "Identity Server",
    "plugins_builder": "Plugins Builder",
    "data_fabric": "Data Fabric",
    "flow_designer": "Flow Designer",
    "app_builder": "App Builder",
    "srm_platform": "SRM Platform",
    "art_api": "ART API",
}

# Labels that are not graph entities: emails are contact strings, co_occurrence
# rows are the sidecar's own pair summary (we recompute pairs exactly, below).
NON_ENTITY_LABELS = {"email", "co_occurrence"}

DEFAULT_MAX_PEOPLE = 28
DEFAULT_MIN_EDGE = 2


@dataclass
class GraphNode:
    id: str
    label: str
    kind: str  # person | product | topic | concept
    weight: int = 0
    description: str = ""
    meta: dict = field(default_factory=dict)


@dataclass
class GraphEdge:
    id: str
    source: str
    target: str
    kind: str  # co_mention | asserted
    weight: float = 0.0
    posts: int = 0
    relation: str = ""
    insight_id: int | None = None


# --- pure helpers (unit-checkable) -------------------------------------------


def person_key(text: str) -> str:
    """Casefolded identity for a person mention ('Sam' and 'sam' are one node)."""
    return f"person:{(text or '').strip().casefold()}"


def product_key(label: str) -> str:
    return f"product:{label}"


def pick_display_name(variants: Counter) -> str:
    """Most frequent surface casing wins; ties break toward Title-case."""
    if not variants:
        return ""
    top = max(variants.values())
    tied = sorted(v for v, n in variants.items() if n == top)
    for v in tied:
        if v[:1].isupper():
            return v
    return tied[0]


def pair_id(a: str, b: str) -> str:
    """Undirected edge id — stable regardless of which end was seen first."""
    lo, hi = sorted((a, b))
    return f"{lo}|{hi}"


def build_cooccurrence(
    rows: list[tuple[int, str, str]],
    max_people: int = DEFAULT_MAX_PEOPLE,
    min_edge: int = DEFAULT_MIN_EDGE,
) -> tuple[dict[str, GraphNode], dict[str, GraphEdge]]:
    """Nodes + co-mention edges from (post_id, entity_label, entity_text) rows.

    An entity is counted once per post, so a name repeated 40 times in one long
    thread does not outweigh a name that 40 different threads mention.
    """
    per_post: dict[int, set[str]] = defaultdict(set)
    mentions: Counter = Counter()
    variants: dict[str, Counter] = defaultdict(Counter)

    for post_id, label, text in rows:
        if label in NON_ENTITY_LABELS:
            continue
        if label == "person":
            if not (text or "").strip():
                continue
            key = person_key(text)
            variants[key][text.strip()] += 1
        else:
            key = product_key(label)
        if key not in per_post[post_id]:
            per_post[post_id].add(key)
            mentions[key] += 1

    people = [k for k in mentions if k.startswith("person:")]
    people.sort(key=lambda k: -mentions[k])
    keep = set(people[:max_people]) | {k for k in mentions if k.startswith("product:")}

    nodes: dict[str, GraphNode] = {}
    for key in keep:
        if key.startswith("person:"):
            nodes[key] = GraphNode(
                id=key,
                label=pick_display_name(variants[key]) or key.split(":", 1)[1],
                kind="person",
                weight=mentions[key],
            )
        else:
            label = key.split(":", 1)[1]
            nodes[key] = GraphNode(
                id=key,
                label=PRODUCT_NAMES.get(label, label.replace("_", " ").title()),
                kind="product",
                weight=mentions[key],
                description=PRODUCT_GLOSSARY.get(label, ""),
                meta={"entity_label": label},
            )

    pair_counts: Counter = Counter()
    for keys in per_post.values():
        present = sorted(k for k in keys if k in keep)
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                pair_counts[(a, b)] += 1

    edges: dict[str, GraphEdge] = {}
    for (a, b), n in pair_counts.items():
        if n < min_edge:
            continue
        eid = pair_id(a, b)
        edges[eid] = GraphEdge(
            id=eid, source=a, target=b, kind="co_mention", weight=float(n), posts=n
        )

    # Drop nodes that ended up with no surviving edge — an isolated dot on a
    # relationship map is noise, not information.
    linked = {e.source for e in edges.values()} | {e.target for e in edges.values()}
    nodes = {k: v for k, v in nodes.items() if k in linked}
    return nodes, edges


def resolve_asserted_endpoint(
    value: str, kind_hint: str, nodes: dict[str, GraphNode]
) -> str:
    """Map a GLM relationship endpoint onto an existing node when it names one.

    The analyst writes free text ('alpha', 'Alpha Platform', 'Sam'); matching it
    back onto the observed graph is what makes the two layers one picture
    instead of two disconnected clouds.
    """
    v = (value or "").strip()
    if not v:
        return ""
    folded = v.casefold()

    if folded.replace(" ", "_") in PRODUCT_NAMES:
        key = product_key(folded.replace(" ", "_"))
        if key in nodes:
            return key
    for key, node in nodes.items():
        if node.kind == "product" and node.label.casefold() == folded:
            return key
    pkey = person_key(v)
    if pkey in nodes:
        return pkey
    # Prefix match catches 'alpha-pt' / 'Alpha BPM' style endpoint text.
    for key, node in nodes.items():
        if node.kind == "product" and (
            folded.startswith(node.label.casefold())
            or folded.startswith(key.split(":", 1)[1])
        ):
            return key
    return f"{kind_hint or 'concept'}:{v}"


def _self_check() -> None:
    rows = [
        (1, "person", "Sam"),
        (1, "person", "Sam"),  # repeat in one post must not double-count
        (1, "alpha", "Alpha"),
        (2, "person", "sam"),  # casing folds onto the same node
        (2, "alpha", "alpha"),
        (2, "studio", "Studio"),
        (3, "person", "Rocky"),
        (3, "alpha", "Alpha"),
        (4, "email", "a@b.com"),  # ignored
        (4, "co_occurrence", "Sam + Alpha"),  # ignored
    ]
    nodes, edges = build_cooccurrence(rows, max_people=10, min_edge=2)
    assert person_key("Sam") in nodes, nodes.keys()
    assert nodes[person_key("Sam")].weight == 2, nodes[person_key("Sam")].weight
    assert nodes[person_key("Sam")].label == "Sam"
    assert nodes[product_key("alpha")].weight == 3
    sam_alpha = pair_id(person_key("Sam"), product_key("alpha"))
    assert sam_alpha in edges, list(edges)
    assert edges[sam_alpha].posts == 2
    # Rocky+Alpha co-occurred once only -> below min_edge -> Rocky is dropped.
    assert person_key("Rocky") not in nodes
    # studio appeared with alpha/Sam once each -> no edge reaches threshold.
    assert product_key("studio") not in nodes

    assert resolve_asserted_endpoint("Alpha Platform", "entity", nodes) == product_key(
        "alpha"
    )
    assert resolve_asserted_endpoint("alpha", "entity", nodes) == product_key("alpha")
    assert resolve_asserted_endpoint("Sam", "entity", nodes) == person_key("Sam")
    assert resolve_asserted_endpoint("URL_access", "deployment", nodes) == (
        "deployment:URL_access"
    )
    assert pair_id("b", "a") == pair_id("a", "b")
    assert pick_display_name(Counter({"sam": 3, "Sam": 3})) == "Sam"
    print("relationship_graph self-check OK")


# --- DB-backed assembly -------------------------------------------------------


async def load_graph(
    session: AsyncSession,
    max_people: int = DEFAULT_MAX_PEOPLE,
    min_edge: int = DEFAULT_MIN_EDGE,
) -> dict:
    rows = (
        await session.execute(
            select(Extraction.post_id, Extraction.entity_label, Extraction.entity_text)
        )
    ).all()
    nodes, edges = build_cooccurrence(
        [(r[0], r[1], r[2]) for r in rows], max_people=max_people, min_edge=min_edge
    )

    rel_rows = (
        await session.execute(
            select(InsightRelationship, AssistantInsight.title)
            .join(AssistantInsight, AssistantInsight.id == InsightRelationship.insight_id)
            .order_by(InsightRelationship.strength.desc())
        )
    ).all()

    for rel, insight_title in rel_rows:
        src = resolve_asserted_endpoint(rel.subject_value, rel.subject_type, nodes)
        tgt = resolve_asserted_endpoint(rel.object_value, rel.object_type, nodes)
        if not src or not tgt or src == tgt:
            continue
        for key, raw_value, raw_kind in ((src, rel.subject_value, rel.subject_type), (tgt, rel.object_value, rel.object_type)):
            if key not in nodes:
                nodes[key] = GraphNode(
                    id=key,
                    label=raw_value,
                    kind="concept",
                    weight=1,
                    meta={"asserted_type": raw_kind},
                )
        eid = f"asserted:{rel.id}"
        edges[eid] = GraphEdge(
            id=eid,
            source=src,
            target=tgt,
            kind="asserted",
            weight=float(rel.strength or 0.5),
            relation=rel.relation,
            insight_id=rel.insight_id,
        )
        nodes[src].meta.setdefault("insights", []).append(rel.insight_id)
        nodes[tgt].meta.setdefault("insights", []).append(rel.insight_id)
        nodes[src].meta.setdefault("insight_titles", [])
        if insight_title not in nodes[src].meta["insight_titles"]:
            nodes[src].meta["insight_titles"].append(insight_title)

    degree: Counter = Counter()
    for e in edges.values():
        degree[e.source] += 1
        degree[e.target] += 1

    return {
        "nodes": [
            {
                "id": n.id,
                "label": n.label,
                "kind": n.kind,
                "weight": n.weight,
                "degree": degree.get(n.id, 0),
                "description": n.description,
                "meta": n.meta,
            }
            for n in nodes.values()
        ],
        "edges": [
            {
                "id": e.id,
                "source": e.source,
                "target": e.target,
                "kind": e.kind,
                "weight": e.weight,
                "posts": e.posts,
                "relation": e.relation,
                "insight_id": e.insight_id,
            }
            for e in edges.values()
            if e.source in nodes and e.target in nodes
        ],
        "stats": {
            "people": sum(1 for n in nodes.values() if n.kind == "person"),
            "products": sum(1 for n in nodes.values() if n.kind == "product"),
            "concepts": sum(1 for n in nodes.values() if n.kind == "concept"),
            "co_mention_edges": sum(
                1 for e in edges.values() if e.kind == "co_mention"
            ),
            "asserted_edges": sum(1 for e in edges.values() if e.kind == "asserted"),
        },
    }


async def sample_posts(
    session: AsyncSession, keys: list[str], limit: int = 6
) -> list[dict]:
    """Posts that mention every key in ``keys`` — the evidence behind an edge."""
    if not keys:
        return []
    post_sets: list[set[int]] = []
    for key in keys:
        kind, value = key.split(":", 1)
        stmt = select(Extraction.post_id).distinct()
        if kind == "person":
            stmt = stmt.where(
                Extraction.entity_label == "person",
                func.lower(Extraction.entity_text) == value.lower(),
            )
        elif kind == "product":
            stmt = stmt.where(Extraction.entity_label == value)
        else:
            return []
        post_sets.append({r[0] for r in (await session.execute(stmt)).all()})
    common = set.intersection(*post_sets) if post_sets else set()
    if not common:
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
            .where(Post.id.in_(list(common)[:400]))
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
            "excerpt": (body or "").strip()[:320],
        }
        for pid, body, dpid, created, title, slug, tdid in rows
    ]


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()

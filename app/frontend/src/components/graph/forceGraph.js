/**
 * Deterministic force layout + pure graph maths for the knowledge graph.
 *
 * The simulation is run to completion synchronously on data load rather than
 * animated tick-by-tick: a map that settles while you are reading it is a
 * worse map, and a deterministic layout means the same picture every visit,
 * so people build a mental model of where things live.
 *
 * Seeded initial placement (golden-angle spiral, no Math.random) is what makes
 * it deterministic — d3-force itself has no randomness once positions are set.
 *
 * Self-check: `node src/components/graph/forceGraph.test.mjs`
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Node radius from mention weight — sqrt so area, not radius, tracks volume. */
export function nodeRadius(weight, maxWeight) {
  const t = Math.sqrt(Math.max(weight, 1) / Math.max(maxWeight, 1))
  return 7 + 17 * Math.min(t, 1)
}

/** Edge stroke width from co-mention count (log — one huge pair can't blow out the scale). */
export function edgeWidth(weight, maxWeight) {
  const t = Math.log1p(Math.max(weight, 0)) / Math.log1p(Math.max(maxWeight, 1))
  return 0.8 + 3.4 * Math.min(Math.max(t, 0), 1)
}

/** Seeded spiral start position — deterministic, well-spread, no RNG. */
export function seedPosition(index, total, width, height) {
  const r = (Math.min(width, height) / 2.3) * Math.sqrt((index + 0.5) / Math.max(total, 1))
  const a = index * GOLDEN_ANGLE
  return { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a) }
}

/** Adjacency: node id -> Set of neighbour ids (used for focus dimming). */
export function buildAdjacency(edges) {
  const adj = new Map()
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a).add(b)
  }
  for (const e of edges) {
    const s = typeof e.source === 'object' ? e.source.id : e.source
    const t = typeof e.target === 'object' ? e.target.id : e.target
    add(s, t)
    add(t, s)
  }
  return adj
}

/**
 * Run the layout to a settled state. Returns plain {id,x,y,r} — the caller
 * never holds d3's mutable node objects in React state.
 */
export function layout(nodes, edges, { width = 960, height = 620, ticks = 420 } = {}) {
  if (!nodes.length) return { nodes: [], edges: [], maxWeight: 1, maxEdge: 1 }

  const maxWeight = Math.max(...nodes.map((n) => n.weight ?? 1), 1)
  const maxEdge = Math.max(...edges.map((e) => e.weight ?? 1), 1)

  const sim = nodes.map((n, i) => ({
    ...n,
    ...seedPosition(i, nodes.length, width, height),
    r: nodeRadius(n.weight ?? 1, maxWeight),
  }))
  const byId = new Map(sim.map((n) => [n.id, n]))
  const links = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ ...e }))

  const simulation = forceSimulation(sim)
    .force(
      'link',
      forceLink(links)
        .id((d) => d.id)
        // Strong pairs pull tighter; asserted edges keep a readable gap so
        // their relation label has room to sit on the line.
        .distance((l) => {
          const t = Math.min((l.weight ?? 1) / maxEdge, 1)
          return l.kind === 'asserted' ? 150 : 190 - 110 * t
        })
        .strength((l) => (l.kind === 'asserted' ? 0.25 : 0.05 + 0.5 * Math.min((l.weight ?? 1) / maxEdge, 1))),
    )
    .force('charge', forceManyBody().strength((d) => -220 - 14 * d.r))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide().radius((d) => d.r + 26).strength(0.9))
    .force('x', forceX(width / 2).strength(0.045))
    .force('y', forceY(height / 2).strength(0.07))
    .stop()

  simulation.tick(ticks)

  // Normalise into the viewBox with a margin, preserving aspect ratio so the
  // layout never looks squashed on a wide card.
  const pad = 60
  const xs = sim.map((n) => n.x)
  const ys = sim.map((n) => n.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY, 1.6)
  const offX = (width - spanX * scale) / 2
  const offY = (height - spanY * scale) / 2

  const placed = sim.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    weight: n.weight,
    degree: n.degree,
    description: n.description,
    meta: n.meta,
    r: n.r,
    x: (n.x - minX) * scale + offX,
    y: (n.y - minY) * scale + offY,
  }))
  const pos = new Map(placed.map((n) => [n.id, n]))

  const drawn = links
    .map((l) => {
      const s = pos.get(typeof l.source === 'object' ? l.source.id : l.source)
      const t = pos.get(typeof l.target === 'object' ? l.target.id : l.target)
      if (!s || !t) return null
      return {
        id: l.id,
        kind: l.kind,
        relation: l.relation,
        weight: l.weight,
        posts: l.posts,
        insightId: l.insight_id ?? l.insightId ?? null,
        source: s.id,
        target: t.id,
        sourceLabel: s.label,
        targetLabel: t.label,
        x1: s.x,
        y1: s.y,
        x2: t.x,
        y2: t.y,
        width: edgeWidth(l.weight ?? 1, maxEdge),
      }
    })
    .filter(Boolean)

  return { nodes: placed, edges: drawn, maxWeight, maxEdge }
}

/** Shorten a label for the on-canvas chip; full text stays in title/panel. */
export const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? '')

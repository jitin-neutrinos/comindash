/**
 * Pure, node-safe helpers for the Cytoscape-based knowledge graph.
 *
 * Deliberately imports NOTHING from theme.js so `node cytoGraph.test.mjs`
 * can run headless in plain node (theme.js pulls tokens.json, which node
 * ESM cannot load without import attributes). All theme/live-color work
 * lives in KnowledgeGraph.jsx's buildStyles().
 *
 * LAYOUT: positions come from forceGraph.js's d3-force `layout()` — the
 * proven, deterministic, container-independent layout that shipped before
 * the Cytoscape migration (fcose produced a tile-ring / collapsed column
 * on this corpus and on narrow viewports; reverted 2026-09-28). The
 * virtual canvas is 1000x660 and the component fits the settled map to
 * whatever viewport is viewing it — a phone sees the same map as a
 * desktop. Cytoscape renders/interacts; d3 positions.
 *
 * Self-check: `node src/components/graph/cytoGraph.test.mjs`
 */
import cytoscape from 'cytoscape'
import { layout as d3Layout } from './forceGraph.js'

export { cytoscape }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Virtual seed box — matches the old viewBox; fcose re-fits after settling. */
export const SEED_W = 1000
export const SEED_H = 660

/** Node radius from mention weight — sqrt so AREA tracks volume, not radius. */
export function nodeRadius(weight, maxWeight) {
  const t = Math.sqrt(Math.max(weight, 1) / Math.max(maxWeight, 1))
  return 7 + 17 * Math.min(t, 1)
}

/** Edge stroke width (log scale — one huge pair cannot blow out the range). */
export function edgeWidth(weight, maxWeight) {
  const t = Math.log1p(Math.max(weight, 0)) / Math.log1p(Math.max(maxWeight, 1))
  return 0.8 + 3.4 * Math.min(Math.max(t, 0), 1)
}

/** Golden-angle spiral start — deterministic, well-spread, no Math.random. */
export function seedPosition(index, total, width = SEED_W, height = SEED_H) {
  const r = (Math.min(width, height) / 2.3) * Math.sqrt((index + 0.5) / Math.max(total, 1))
  const a = index * GOLDEN_ANGLE
  return { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a) }
}

/** Nodes at/below this radius hide their label unless lit (same rule as before). */
export const SMALL_R = 13

/** relation key -> display text ("correlates_with" -> "correlates with"). */
export const relLabel = (relation) => String(relation ?? '').replace(/_/g, ' ')

/**
 * Graph payload -> Cytoscape elements. Node/edge data carries every field
 * the InsightPanel reads from a selection payload, so the tap handler can
 * hand React the exact same object shape the SVG version produced.
 */
export function toElements(graph) {
  const nodesIn = graph?.nodes ?? []
  const edgesIn = graph?.edges ?? []
  if (!nodesIn.length) return { nodes: [], edges: [] }

  // d3-force settles on the fixed virtual canvas — deterministic and
  // container-independent (the reason fcose was reverted).
  const placed = d3Layout(nodesIn, edgesIn, { width: SEED_W, height: SEED_H })
  const posById = new Map(placed.nodes.map((n) => [n.id, n]))
  const maxWeight = Math.max(...nodesIn.map((n) => n.weight ?? 1), 1)
  const maxEdge = Math.max(...edgesIn.map((e) => e.weight ?? 1), 1)
  const idSet = new Set(nodesIn.map((n) => n.id))

  const nodes = nodesIn.map((n, i) => {
    const r = nodeRadius(n.weight ?? 1, maxWeight)
    return {
      data: {
        id: n.id,
        label: n.label,
        kind: n.kind,
        weight: n.weight ?? 1,
        degree: n.degree ?? 0,
        description: n.description ?? null,
        meta: n.meta ?? null,
        size: r * 2,
        fsize: r > 15 ? 12 : 11,
      },
      position: { x: posById.get(n.id)?.x ?? 0, y: posById.get(n.id)?.y ?? 0 },
      classes: [`k-${n.kind ?? 'product'}`, r <= SMALL_R ? 'sm' : ''].filter(Boolean),
    }
  })

  const edges = edgesIn
    .filter((e) => idSet.has(e.source) && idSet.has(e.target))
    .map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        relation: e.relation ?? null,
        relLabel: relLabel(e.relation),
        weight: e.weight ?? 1,
        posts: e.posts ?? 0,
        insightId: e.insight_id ?? e.insightId ?? null,
        sourceLabel: e.sourceLabel ?? e.source,
        targetLabel: e.targetLabel ?? e.target,
        width: edgeWidth(e.weight ?? 1, maxEdge),
      },
      classes: [e.kind === 'asserted' ? 'k-as' : 'k-co'],
    }))

  return { nodes, edges }
}

/**
 * Layout descriptor for the component: preset positions from d3-force,
 * already stamped onto the elements by toElements(). The component runs
 * this then fits to the viewport; the fit is the entrance motion.
 */
export function layoutOptions() {
  return { name: 'preset' }
}

/**
 * Run the layout headless; resolves id -> {x, y}. Used by the self-check
 * (determinism) — same d3 positions the live component uses.
 */
export function runLayout(graph) {
  const els = toElements(graph)
  const pos = {}
  for (const n of els.nodes) pos[n.data.id] = { x: n.position.x, y: n.position.y }
  return Promise.resolve(pos)
}

/**
 * Pure, node-safe helpers for the Cytoscape-based knowledge graph.
 *
 * Deliberately imports NOTHING from theme.js so `node cytoGraph.test.mjs`
 * can run headless in plain node (theme.js pulls tokens.json, which node
 * ESM cannot load without import attributes). All theme/live-color work
 * lives in KnowledgeGraph.jsx's buildStyles().
 *
 * Determinism contract: element positions are seeded with a golden-angle
 * spiral (no RNG) and fcose runs with randomize:false, so the same graph
 * always settles to the same picture — people build a mental map of where
 * things live.
 *
 * Self-check: `node src/components/graph/cytoGraph.test.mjs`
 */
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'

cytoscape.use(fcose)
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
      position: seedPosition(i, nodesIn.length),
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
 * fcose layout options. `animate` off for reduced-motion/headless — the
 * animated settle IS the entrance choreography, so no separate gsap layer.
 */
export function layoutOptions(animate) {
  return {
    name: 'fcose',
    quality: 'proof',
    randomize: false, // seeded spiral starts -> deterministic
    animate,
    animationDuration: 620,
    animationEasing: 'ease-out',
    padding: 46,
    nodeSeparation: 95,
    idealEdgeLength: (edge) => (edge.data('kind') === 'asserted' ? 165 : 120),
    edgeElasticity: 0.45,
    gravity: 0.25,
    gravityRange: 3.8,
    numIter: 3000,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
  }
}

/**
 * Run the layout headless and settle the returned promise with a
 * id -> {x, y} map. Used by the self-check (determinism) — the live
 * component runs the same options on its own instance.
 */
export function runLayout(graph) {
  return new Promise((resolve, reject) => {
    let cy
    try {
      cy = cytoscape({ elements: toElements(graph), headless: true })
    } catch (err) {
      reject(err)
      return
    }
    const layout = cy.layout({ ...layoutOptions(false), animate: false })
    layout.one('layoutstop', () => {
      const pos = {}
      cy.nodes().forEach((n) => {
        pos[n.id()] = { x: n.position('x'), y: n.position('y') }
      })
      cy.destroy()
      resolve(pos)
    })
    layout.run()
  })
}

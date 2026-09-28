/**
 * Self-check for the force layout maths. Run:
 *   node src/components/graph/forceGraph.test.mjs
 * Exits non-zero on the first failed assertion.
 */
import assert from 'node:assert/strict'
import { buildAdjacency, edgeWidth, layout, nodeRadius, seedPosition, truncate } from './forceGraph.js'

// --- scales -----------------------------------------------------------------
assert.ok(nodeRadius(1, 100) < nodeRadius(50, 100), 'radius grows with weight')
assert.ok(nodeRadius(100, 100) <= 24.01, 'radius is capped')
assert.ok(nodeRadius(0, 100) >= 7, 'zero weight still draws a visible dot')
assert.ok(edgeWidth(1, 200) < edgeWidth(200, 200), 'edge width grows with weight')
assert.ok(edgeWidth(0, 1) >= 0.8, 'zero-weight edge is still hairline-visible')

// --- determinism ------------------------------------------------------------
const a = seedPosition(3, 20, 800, 600)
const b = seedPosition(3, 20, 800, 600)
assert.deepEqual(a, b, 'seed positions are deterministic')

const nodes = [
  { id: 'person:sam', label: 'Sam', kind: 'person', weight: 900, degree: 8 },
  { id: 'product:alpha', label: 'Alpha Platform', kind: 'product', weight: 700, degree: 9 },
  { id: 'product:studio', label: 'Studio', kind: 'product', weight: 300, degree: 3 },
  { id: 'concept:URL_access', label: 'URL access', kind: 'concept', weight: 1, degree: 1 },
]
const edges = [
  { id: 'e1', source: 'person:sam', target: 'product:alpha', kind: 'co_mention', weight: 225, posts: 225 },
  { id: 'e2', source: 'product:alpha', target: 'product:studio', kind: 'co_mention', weight: 124, posts: 124 },
  { id: 'e3', source: 'product:alpha', target: 'concept:URL_access', kind: 'asserted', weight: 0.9, relation: 'has_issue_with', insight_id: 1 },
  { id: 'dangling', source: 'product:alpha', target: 'missing:node', kind: 'co_mention', weight: 5 },
]

const r1 = layout(nodes, edges, { width: 900, height: 600, ticks: 200 })
const r2 = layout(nodes, edges, { width: 900, height: 600, ticks: 200 })
assert.deepEqual(
  r1.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
  r2.nodes.map((n) => [n.id, Math.round(n.x), Math.round(n.y)]),
  'layout is deterministic across runs',
)

assert.equal(r1.nodes.length, 4, 'every node is placed')
assert.equal(r1.edges.length, 3, 'edge pointing at a missing node is dropped, not rendered')

for (const n of r1.nodes) {
  assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} has finite coords`)
  assert.ok(n.x >= 0 && n.x <= 900, `${n.id} x inside viewBox: ${n.x}`)
  assert.ok(n.y >= 0 && n.y <= 600, `${n.id} y inside viewBox: ${n.y}`)
}

// Nodes must not overlap (collide force + radius) — the readability guarantee.
for (let i = 0; i < r1.nodes.length; i += 1) {
  for (let j = i + 1; j < r1.nodes.length; j += 1) {
    const p = r1.nodes[i]
    const q = r1.nodes[j]
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    assert.ok(d > p.r + q.r, `${p.id} and ${q.id} overlap (d=${d.toFixed(1)})`)
  }
}

// Edge endpoints must match their node positions exactly (no drift).
const pos = new Map(r1.nodes.map((n) => [n.id, n]))
for (const e of r1.edges) {
  assert.equal(e.x1, pos.get(e.source).x, 'edge start tracks its source node')
  assert.equal(e.y2, pos.get(e.target).y, 'edge end tracks its target node')
}

// --- adjacency --------------------------------------------------------------
const adj = buildAdjacency(edges.slice(0, 3))
assert.ok(adj.get('person:sam').has('product:alpha'), 'adjacency is undirected (forward)')
assert.ok(adj.get('product:alpha').has('person:sam'), 'adjacency is undirected (reverse)')
assert.equal(adj.get('product:alpha').size, 3, 'alpha neighbours: sam, studio, URL_access')

// --- truncate ---------------------------------------------------------------
assert.equal(truncate('Alpha Platform', 8), 'Alpha P…')
assert.equal(truncate('Sam', 8), 'Sam')
assert.equal(truncate(undefined, 8), '')

console.log('forceGraph self-check OK —', r1.nodes.length, 'nodes,', r1.edges.length, 'edges')

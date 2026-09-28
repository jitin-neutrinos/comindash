/**
 * Self-check for cytoGraph.js — run with `node src/components/graph/cytoGraph.test.mjs`
 * (cwd = frontend/). Vite maps bare `cytoscape` via node_modules, node needs the
 * explicit .js path — both resolve to the same module.
 */
import {
  cytoscape,
  edgeWidth,
  layoutOptions,
  nodeRadius,
  relLabel,
  runLayout,
  seedPosition,
  toElements,
} from './cytoGraph.js'
import assert from 'node:assert/strict'

// --- pure helpers -----------------------------------------------------------
assert.equal(nodeRadius(10, 10), 24) // weight == max -> max radius
assert.equal(nodeRadius(1, 1), 24) // weight == max (single node) -> max radius
assert.ok(Math.abs(nodeRadius(1, 40) - (7 + 17 * Math.sqrt(1 / 40))) < 1e-9)
assert.equal(edgeWidth(0, 10), 0.8)
assert.equal(relLabel('correlates_with'), 'correlates with')
assert.equal(relLabel(null), '')
const s0 = seedPosition(0, 5)
assert.ok(Math.hypot(s0.x - 500, s0.y - 330) < 100, 'first seed near centre')
const s1 = seedPosition(1, 5)
assert.notDeepEqual(s0, s1, 'seeds distinct')
assert.ok(Math.abs(s0.x - s1.x) > 1 || Math.abs(s0.y - s1.y) > 1)

// --- toElements: contract with the React selection payload -------------------
const g = {
  nodes: [
    { id: 'p1', label: 'Alpha', kind: 'product', weight: 40, degree: 3 },
    { id: 'p2', label: 'studio', kind: 'product', weight: 10, degree: 1 },
    { id: 'c1', label: 'Sam', kind: 'person', weight: 25, degree: 2 },
    { id: 'k1', label: 'jBPM', kind: 'concept', weight: 5, degree: 1 },
  ],
  edges: [
    { id: 'e1', source: 'p1', target: 'c1', kind: 'co_mention', weight: 9, posts: 12 },
    { id: 'e2', source: 'p2', target: 'c1', kind: 'asserted', relation: 'correlates_with', weight: 0.7, posts: 3 },
    { id: 'e3', source: 'p1', target: 'GHOST', kind: 'co_mention', weight: 2, posts: 1 }, // dangling -> dropped
  ],
}
const els = toElements(g)
assert.equal(els.nodes.length, 4)
assert.equal(els.edges.length, 2, 'dangling edge dropped')
assert.equal(els.edges[1].data.relLabel, 'correlates with')
assert.equal(els.edges[0].data.posts, 12)
assert.ok(els.nodes.every((n) => typeof n.position.x === 'number' && typeof n.position.y === 'number'))
// determinism of element construction
assert.deepEqual(toElements(g), els)

// --- headless cytoscape + fcose run: layout is deterministic ----------------
const pos1 = await runLayout(g)
assert.equal(Object.keys(pos1).length, 4)
for (const [id, p] of Object.entries(pos1)) {
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${id} finite`)
  assert.ok(Math.abs(p.x) < 1e6 && Math.abs(p.y) < 1e6, `${id} bounded`)
}
const pos2 = await runLayout(g)
assert.deepEqual(pos1, pos2, 'fcose with seeded starts is deterministic')

// --- layoutOptions sanity ----------------------------------------------------
const lo = layoutOptions(true)
assert.equal(lo.name, 'fcose')
assert.equal(lo.randomize, false)
assert.equal(lo.animate, true)
assert.equal(layoutOptions(false).animate, false)

// --- cytoscape instance still builds headless -------------------------------
const cy = cytoscape({ headless: true })
cy.add(els.nodes)
cy.add(els.edges)
assert.equal(cy.nodes().length, 4)
assert.equal(cy.edges().length, 2)
cy.destroy()

console.log('cytoGraph self-check OK —', els.nodes.length, 'nodes,', els.edges.length, 'edges, deterministic fcose')

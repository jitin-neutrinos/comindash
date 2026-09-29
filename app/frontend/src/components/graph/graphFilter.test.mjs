/**
 * Self-check for graphFilter.js — `node src/components/graph/graphFilter.test.mjs`
 * Pins: facet filtering semantics, orphan removal, cross-filter
 * availability (an option that would empty the graph is unavailable),
 * select-all honouring availability, stats accuracy.
 */
import { applyFilters, facetAvailability, facetOptions, graphStats } from './graphFilter.js'
import assert from 'node:assert/strict'

const G = {
  nodes: [
    { id: 'person:sam', label: 'Sam', kind: 'person', weight: 90, degree: 3 },
    { id: 'person:ana', label: 'Ana', kind: 'person', weight: 30, degree: 1 },
    { id: 'product:alpha', label: 'alpha', kind: 'product', weight: 60, degree: 2 },
    { id: 'product:studio', label: 'studio', kind: 'product', weight: 20, degree: 1 },
    { id: 'concept:jobs', label: 'async jobs', kind: 'concept', weight: 10, degree: 1 },
  ],
  edges: [
    { id: 'e1', source: 'person:sam', target: 'product:alpha', kind: 'co_mention', weight: 9, posts: 12 },
    { id: 'e2', source: 'person:ana', target: 'product:studio', kind: 'co_mention', weight: 2, posts: 2 },
    { id: 'e3', source: 'person:sam', target: 'concept:jobs', kind: 'asserted', relation: 'correlates_with', weight: 0.7, posts: 1 },
  ],
}

// --- no filters = whole graph ------------------------------------------------
const all = applyFilters(G, {})
assert.equal(all.nodes.length, 5)
assert.equal(all.edges.length, 3)

// --- person facet -------------------------------------------------------------
const sam = applyFilters(G, { people: ['person:sam'] })
assert.equal(sam.edges.length, 2, 'sam has 2 edges')
assert.ok(sam.nodes.some((n) => n.id === 'product:alpha'))
assert.ok(!sam.nodes.some((n) => n.id === 'person:ana'), 'ana excluded')
assert.ok(!sam.nodes.some((n) => n.id === 'product:studio'), 'studio orphaned -> dropped')

// --- product facet -----------------------------------------------------------
const studio = applyFilters(G, { products: ['product:studio'] })
// e2 (ana-studio) survives; e1 dies (alpha not selected); e3 survives
// (sam↔jobs involves no product). Unfiltered kinds stay live.
assert.equal(studio.edges.length, 2)
assert.ok(studio.nodes.some((n) => n.id === 'product:studio'))
assert.ok(!studio.nodes.some((n) => n.id === 'product:alpha'), 'alpha filtered out')

// --- multi-select union -------------------------------------------------------
const both = applyFilters(G, { people: ['person:sam', 'person:ana'] })
assert.equal(both.edges.length, 3)

// --- link-kind facets ---------------------------------------------------------
const measuredOnly = applyFilters(G, { asserted: false })
assert.equal(measuredOnly.edges.length, 2)
assert.ok(measuredOnly.edges.every((e) => e.kind === 'co_mention'))
const assertedOnly = applyFilters(G, { measured: false })
assert.equal(assertedOnly.edges.length, 1)
assert.equal(assertedOnly.edges[0].id, 'e3')
// orphan removal: asserted-only drops ana & studio (no asserted edges)
assert.ok(!assertedOnly.nodes.some((n) => n.id === 'person:ana'))

// --- cross-filter availability ------------------------------------------------
// With product=studio locked: Ana pairs directly with studio; Sam also
// stays available because his asserted edge (sam↔jobs) involves no product.
// But if link-kind filters remove BOTH of a person's edges, they vanish:
const av = facetAvailability(G, { products: ['product:studio'], asserted: false })
assert.ok(av.people.has('person:ana'), 'ana available')
assert.ok(!av.people.has('person:sam'), 'sam has no surviving edge under studio+no-asserted')
assert.ok(av.products.has('product:studio'), 'selected product stays available')
assert.ok(av.measured, 'measured links still visible under studio')
// availability flags are INDEPENDENT of the toggles: 'asserted available'
// answers "would turning it on show something" — true even while toggled off.

// measured=false base: availability stays INDEPENDENT of toggles (the
// flag means "would turning it on show something", which stays true).
const av2 = facetAvailability(G, { measured: false })
assert.equal(av2.asserted, true, 'asserted still possible')
assert.equal(av2.measured, true, 'measured availability independent of its own toggle')

// --- facetOptions -------------------------------------------------------------
const opts = facetOptions(G)
assert.ok(opts.people.length === 2 && opts.products.length === 2)
assert.ok(opts.people[0].hint.endsWith('links'))

// --- stats ---------------------------------------------------------------------
const st = graphStats(G)
assert.equal(st.total.nodes, 5)
assert.equal(st.links.measured, 2)
assert.equal(st.links.asserted, 1)
assert.equal(st.topPeople[0].id, 'person:sam')
assert.equal(st.strongestMeasured[0].id, 'e1')

console.log('graphFilter self-check OK —', all.nodes.length, 'nodes /', all.edges.length, 'edges, cross-filter availability verified')

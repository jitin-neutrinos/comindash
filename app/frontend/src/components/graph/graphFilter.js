/**
 * Pure cross-filtering engine for the knowledge graph (node-safe).
 *
 * Four facets: people, products, measured links (co_mention), analyst
 * links (asserted). Empty selection in a facet = "all". The engine
 * computes, for each facet, the set of values that would still yield a
 * NON-EMPTY graph if picked given the other three facets' selections —
 * that set drives the dropdowns' disabled states, so a combination that
 * would blank the map is visibly greyed instead of silently emptying it.
 *
 * Semantics: nodes survive if they pass the people/product facets AND
 * remain connected to at least one surviving edge (no orphan dots);
 * edges survive if their kind passes the link facets AND both endpoints
 * survive. Cross-filter availability is recomputed from that definition.
 *
 * Self-check: `node src/components/graph/graphFilter.test.mjs`
 */

/** Graph-level stats reused by filters + infographic sections. */
export function graphStats(graph) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const people = nodes.filter((n) => n.kind === 'person')
  const products = nodes.filter((n) => n.kind === 'product')
  const concepts = nodes.filter((n) => n.kind === 'concept')
  const measured = edges.filter((e) => e.kind === 'co_mention')
  const asserted = edges.filter((e) => e.kind === 'asserted')
  const deg = new Map()
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  const top = (arr) => [...arr].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
  return {
    total: { nodes: nodes.length, edges: edges.length },
    kinds: { people: people.length, products: products.length, concepts: concepts.length },
    links: { measured: measured.length, asserted: asserted.length },
    degree: deg,
    topPeople: top(people).slice(0, 8),
    topProducts: top(products).slice(0, 8),
    topConcepts: top(concepts).slice(0, 8),
    strongestMeasured: [...measured].sort((a, b) => (b.posts ?? 0) - (a.posts ?? 0)).slice(0, 8),
    strongestAsserted: [...asserted].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 8),
  }
}

/**
 * Core filter. `facets` = { people: [id], products: [id], measured: bool,
 * asserted: bool } — arrays empty = all; booleans = include that link kind.
 * Returns the sub-graph (same node/edge shapes) + derived stats.
 */
export function applyFilters(graph, facets) {
  const nodesIn = graph?.nodes ?? []
  const edgesIn = graph?.edges ?? []
  const people = new Set(facets?.people ?? [])
  const products = new Set(facets?.products ?? [])
  const keepMeasured = facets?.measured !== false
  const keepAsserted = facets?.asserted !== false

  // Pass 1: node survival by kind facets.
  const nodeOk = new Map()
  for (const n of nodesIn) {
    let ok = true
    if (n.kind === 'person' && people.size) ok = people.has(n.id)
    if (n.kind === 'product' && products.size) ok = products.has(n.id)
    nodeOk.set(n.id, ok)
  }

  // Pass 2: edge survival (kind + both endpoints).
  const edges = edgesIn.filter((e) => {
    if (e.kind === 'asserted' && !keepAsserted) return false
    if (e.kind !== 'asserted' && !keepMeasured) return false
    return nodeOk.get(e.source) && nodeOk.get(e.target)
  })

  // Pass 3: drop orphan nodes (no surviving edge touches them).
  const touched = new Set()
  for (const e of edges) {
    touched.add(e.source)
    touched.add(e.target)
  }
  const nodes = nodesIn.filter((n) => nodeOk.get(n.id) && touched.has(n.id))

  return { nodes, edges, stats: graphStats({ nodes, edges }) }
}

/**
 * Availability per facet: values that keep the graph non-empty given the
 * OTHER facets. Implemented as: for candidate value v in facet F, filter
 * with F=[v] and the other facets unchanged; keep v if any edge survives.
 */
export function facetAvailability(graph, facets) {
  const base = {
    people: facets?.people ?? [],
    products: facets?.products ?? [],
    measured: facets?.measured !== false,
    asserted: facets?.asserted !== false,
  }
  const canSee = (f) => applyFilters(graph, f).edges.length > 0

  const people = new Set()
  for (const n of graph?.nodes ?? []) {
    if (n.kind !== 'person') continue
    if (base.people.includes(n.id) || canSee({ ...base, people: [n.id] })) people.add(n.id)
  }
  const products = new Set()
  for (const n of graph?.nodes ?? []) {
    if (n.kind !== 'product') continue
    if (base.products.includes(n.id) || canSee({ ...base, products: [n.id] })) products.add(n.id)
  }

  // Link-kind availability: independent of each other — a kind is
  // available if at least one edge of that kind survives the NODE facets
  // (enabling it then always shows something).
  const nodeFacets = { people: base.people, products: base.products }
  const kindsUp = (kind) =>
    (graph?.edges ?? []).some(
      (e) => e.kind === kind && applyFilters(graph, nodeFacets).edges.some((x) => x.id === e.id),
    )
  const measured = kindsUp('co_mention')
  const asserted = kindsUp('asserted')

  return { people, products, measured, asserted }
}

/** Option lists for the dropdowns, ranked by degree, with link hints. */
export function facetOptions(graph) {
  const nodes = graph?.nodes ?? []
  const edges = graph?.edges ?? []
  const linksOf = new Map()
  for (const e of edges) {
    linksOf.set(e.source, (linksOf.get(e.source) ?? 0) + 1)
    linksOf.set(e.target, (linksOf.get(e.target) ?? 0) + 1)
  }
  const mk = (kind) =>
    nodes
      .filter((n) => n.kind === kind)
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
      .map((n) => ({
        value: n.id,
        label: n.label,
        hint: `${linksOf.get(n.id) ?? 0} links`,
      }))
  return { people: mk('person'), products: mk('product') }
}

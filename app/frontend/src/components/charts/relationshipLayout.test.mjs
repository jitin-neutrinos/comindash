// Self-check for RelationshipMap layout: run `node relationshipLayout.test.mjs`.
// Asserts the three things the overlap fix promises: labels stay inside the
// frame, no link line crosses a label, and no label sits on top of a node.
import assert from 'node:assert/strict'
import { layoutGraph, labelBox } from './relationshipLayout.js'
import { buildGraph } from '../../metricInfo.js'

const rectsOverlap = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

const circleBox = (n) => ({ left: n.x - n.r, right: n.x + n.r, top: n.y - n.r, bottom: n.y + n.r })

// Standard segment/axis-aligned-rect intersection via the slab method.
function segmentHitsRect(x1, y1, x2, y2, r) {
  const dx = x2 - x1
  const dy = y2 - y1
  let t0 = 0
  let t1 = 1
  for (const [p, q] of [
    [-dx, x1 - r.left],
    [dx, r.right - x1],
    [-dy, y1 - r.top],
    [dy, r.bottom - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

function check(name, graph, box) {
  const { placed, edges, fontSize } = layoutGraph(graph.nodes, graph.links, box)
  const labelled = placed.filter((n) => n.label)

  // 1. The hub is centred and deliberately unlabelled (the panel heading names it).
  const hub = placed.find((n) => n.type === 'focus')
  if (hub) {
    assert.equal(hub.x, box.width / 2, `${name}: hub off-centre`)
    assert.equal(hub.label, null, `${name}: hub should carry no label`)
  }

  for (const n of labelled) {
    const lb = labelBox(n.label, fontSize)

    // 2. Nothing is cut off at the edge of the frame.
    assert.ok(lb.left >= 0 && lb.right <= box.width, `${name}: "${n.label.text}" overflows horizontally`)
    assert.ok(lb.top >= 0 && lb.bottom <= box.height, `${name}: "${n.label.text}" overflows vertically`)

    // 3. No label sits on top of a node circle.
    for (const other of placed) {
      assert.ok(!rectsOverlap(lb, circleBox(other)), `${name}: "${n.label.text}" collides with node ${other.id}`)
    }

    // 4. No link line runs through a label — the actual "lines cut the text" bug.
    for (const e of edges) {
      assert.ok(
        !segmentHitsRect(e.x1, e.y1, e.x2, e.y2, lb),
        `${name}: link crosses label "${n.label.text}"`,
      )
    }
  }

  // 5. Labels do not sit on top of each other.
  for (let i = 0; i < labelled.length; i += 1) {
    for (let j = i + 1; j < labelled.length; j += 1) {
      assert.ok(
        !rectsOverlap(labelBox(labelled[i].label, fontSize), labelBox(labelled[j].label, fontSize)),
        `${name}: labels "${labelled[i].label.text}" and "${labelled[j].label.text}" overlap`,
      )
    }
  }

  // 6. Link ends are trimmed back to the circle edge, so no line tunnels a node.
  for (const e of edges) {
    const s = placed.find((n) => n.id === (e.raw.source?.id ?? e.raw.source))
    const t = placed.find((n) => n.id === (e.raw.target?.id ?? e.raw.target))
    const full = Math.hypot(t.x - s.x, t.y - s.y)
    const drawn = Math.hypot(e.x2 - e.x1, e.y2 - e.y1)
    assert.ok(drawn < full, `${name}: link not trimmed`)
    assert.ok(Math.hypot(e.x1 - s.x, e.y1 - s.y) >= s.r, `${name}: link starts inside source node`)
  }

  console.log(`ok  ${name}  (${placed.length} nodes, ${labelled.length} labels, ${edges.length} links)`)
}

// Every info-panel mini-map, at the size the panel actually renders it.
const PANEL = { width: 288, height: 210, pad: 58 }
for (const key of ['totalPosts', 'avgSentiment', 'highPriority', 'activePainPoints', 'modelConfidence', 'overviewPage', 'postsTable']) {
  check(`panel:${key}`, buildGraph(key), PANEL)
}

// The full-page connection map, with a realistic API-shaped graph.
const TYPES = ['entity', 'topic', 'insight']
for (const count of [3, 6, 10, 14, 20, 28, 40]) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    type: TYPES[i % 3],
    value: ['Authentication flow', 'Billing', 'Mobile app crash on launch', 'Docs'][i % 4],
    weight: Math.max(1, 100 - i * 5), // includes the floor case: many equal-weight nodes
  }))
  const links = nodes.slice(1).map((n, i) => ({
    source: { id: nodes[i].id },
    target: { id: n.id },
    relation: 'related',
    strength: 0.5,
  }))
  check(`page:${count}-nodes`, { nodes, links }, { width: 800, height: 520, pad: 90 })
}

console.log('\nall layout checks passed')

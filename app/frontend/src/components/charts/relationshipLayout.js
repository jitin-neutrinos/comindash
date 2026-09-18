/**
 * Pure layout maths for RelationshipMap.
 *
 * Three rules keep graphics off text:
 *   1. A `focus` node (the info panel's hub) sits dead centre and is drawn
 *      unlabelled; everything else sits on a ring around it.
 *   2. Labels are pushed radially *outward*, away from the centre, and
 *      anchored start/end on the sides — so the label of a node never sits
 *      where that node's links run.
 *   3. Every label box is clamped inside the viewBox, so nothing is cut off
 *      at the edge.
 *
 * Link endpoints are trimmed to the circle edge so lines never tunnel through
 * a node.
 */

const TAU = Math.PI * 2

export const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Rough advance width of a Poppins string — good enough for edge clamping. */
export const textWidth = (s, fontSize) => s.length * fontSize * 0.56

export function layoutGraph(nodes, links, { width, height, pad }) {
  const cx = width / 2
  const cy = height / 2
  const radius = Math.max(8, Math.min(width, height) / 2 - pad)
  const compact = width < 420
  const fontSize = compact ? 10 : 11
  const maxChars = compact ? 12 : 18

  const sorted = [...nodes].sort((a, b) => b.weight - a.weight)
  const maxWeight = Math.max(...sorted.map((n) => n.weight), 1)
  // Clamped: a zero or negative weight from the API must not yield a
  // negative-radius circle.
  const nodeRadius = (n) => 8 + 10 * Math.min(Math.max((n.weight ?? 0) / maxWeight, 0), 1)

  const hub = sorted.find((n) => n.type === 'focus')
  const ring = sorted.filter((n) => n !== hub)

  // Labels live on their own ring *outside* every node circle, so a label can
  // never land on a dot and a link (always a chord inside the node ring) can
  // never cross one. Odd nodes sit one line further out so neighbouring
  // labels on a crowded ring do not collide with each other.
  const maxRingR = Math.max(...ring.map(nodeRadius), 0)
  const labelRadius = radius + maxRingR + fontSize + 4
  // Crowded ring: more stagger lanes, and shorter text so neighbours clear.
  const lanes = ring.length > 16 ? 3 : 2
  // ponytail: past ~20 ring nodes the labels stop fitting at any readable font
  // size, so label an evenly spread subset and leave the rest to hover titles.
  // Upgrade path: force-directed layout, or a legend list beside the map.
  const labelStep = Math.max(1, Math.ceil(ring.length / 20))
  const arcPerLabel = ((TAU * labelRadius) / Math.max(ring.length, 1)) * lanes
  const fitChars = Math.max(6, Math.floor(arcPerLabel / (fontSize * 0.56)))
  const chars = Math.min(maxChars, fitChars)

  const placed = []
  if (hub) placed.push({ ...hub, r: nodeRadius(hub), x: cx, y: cy, label: null })

  ring.forEach((n, i) => {
    const angle = (i / ring.length) * TAU - Math.PI / 2
    const r = nodeRadius(n)
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    const lr = labelRadius + (i % lanes) * (fontSize + 4)
    placed.push({
      ...n,
      r,
      x,
      y,
      label:
        i % labelStep === 0
          ? placeLabel(n, { angle, cx, cy, labelRadius: lr, width, height, fontSize, maxChars: chars })
          : null,
    })
  })

  const byId = new Map(placed.map((n) => [n.id, n]))

  const edges = links.flatMap((l) => {
    const s = byId.get(l.source?.id ?? l.source) ?? l.source
    const t = byId.get(l.target?.id ?? l.target) ?? l.target
    const dx = t.x - s.x
    const dy = t.y - s.y
    const len = Math.hypot(dx, dy) || 1
    const sr = (s.r ?? 0) + 1
    const tr = (t.r ?? 0) + 1
    // Circles already touching: a trimmed line would be zero-length or
    // inside-out, so draw nothing rather than a stub across the dots.
    if (len <= sr + tr + 2) return []
    return {
      raw: l,
      // Trimmed to the circle edges: no line under a node, no arrow into text.
      x1: s.x + (dx / len) * sr,
      y1: s.y + (dy / len) * sr,
      x2: t.x - (dx / len) * tr,
      y2: t.y - (dy / len) * tr,
    }
  })

  return { placed, edges, fontSize, cx, cy, radius }
}

function placeLabel(n, { angle, cx, cy, labelRadius, width, height, fontSize, maxChars }) {
  const text = truncate(n.value, maxChars)
  const w = textWidth(text, fontSize)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)

  let anchor = 'middle'
  if (dx > 0.15) anchor = 'start'
  else if (dx < -0.15) anchor = 'end'

  let tx = cx + labelRadius * dx
  let ty = cy + labelRadius * dy + fontSize * 0.35
  if (anchor === 'middle') ty = dy < 0 ? ty - fontSize * 0.5 : ty + fontSize * 0.5

  // Clamp the label's own box inside the viewBox (4px safe margin).
  const m = 4
  if (anchor === 'start') tx = Math.min(tx, width - w - m)
  else if (anchor === 'end') tx = Math.max(tx, w + m)
  else tx = Math.min(Math.max(tx, w / 2 + m), width - w / 2 - m)
  ty = Math.min(Math.max(ty, fontSize + m), height - m)

  return { text, anchor, x: tx, y: ty, w }
}

/** Label bounding box, for tests and for anyone reasoning about collisions. */
export function labelBox(label, fontSize) {
  const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - label.w : label.x - label.w / 2
  return { left, right: left + label.w, top: label.y - fontSize * 0.8, bottom: label.y + fontSize * 0.25 }
}

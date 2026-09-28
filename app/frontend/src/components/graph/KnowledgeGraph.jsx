import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { alpha, colors, graph } from '../../theme'
import { canAnimateEntrance, gsap, prefersReducedMotion } from '../../motion'
import { buildAdjacency, layout, truncate } from './forceGraph'

const W = 1000
const H = 660

/**
 * Node palette. Brand rule: White + Neutrinos Blue dominate, exactly ONE
 * accent. Products are Blue (the subject of the platform), people are
 * Midnight (core), and Celeste is the single accent reserved for the
 * analyst-asserted layer — concepts and their edges.
 */
/* Live palette getters (functions, not consts): colors/graph are live
 * bindings that change with the theme mode — a module-level const would
 * freeze light-mode fills into dark mode. */
export const kindStyle = () => ({
  product: { fill: colors.blue, label: 'Product' },
  person: { fill: graph.personFill, label: 'Person' },
  concept: { fill: colors.celeste, label: 'Analyst concept' },
})

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

/**
 * Interactive knowledge-graph canvas.
 *
 * Interaction model, chosen so the map stays legible as it grows:
 *   - hover        : neighbourhood highlight, everything else dims
 *   - click node   : select it (panel opens); its neighbourhood stays lit
 *   - click edge   : select the pair
 *   - drag / wheel : pan & zoom, clamped
 *   - keyboard     : Tab through nodes, Enter/Space selects, Escape clears
 *
 * Motion: the layout is computed settled (never animated tick-by-tick — a map
 * that moves while you read it is a worse map); only entrance and selection
 * transitions animate, all under 300ms, all reduced-motion guarded.
 */
export default function KnowledgeGraph({
  graph,
  selection,
  onSelect,
  height = 620,
  showLabels = true,
}) {
  const root = useRef(null)
  const svgRef = useRef(null)
  const [hover, setHover] = useState(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef(null)

  const placed = useMemo(
    () => layout(graph?.nodes ?? [], graph?.edges ?? [], { width: W, height: H }),
    [graph],
  )
  const adjacency = useMemo(() => buildAdjacency(graph?.edges ?? []), [graph])
  const byId = useMemo(() => new Map(placed.nodes.map((n) => [n.id, n])), [placed])

  // The active focus: an explicit selection wins over a transient hover.
  const focusNode =
    selection?.type === 'node' ? selection.keys[0] : hover?.type === 'node' ? hover.id : null
  const focusEdge =
    selection?.type === 'edge' ? selection.edgeId : hover?.type === 'edge' ? hover.id : null

  const lit = useMemo(() => {
    if (focusNode) {
      const set = new Set([focusNode])
      for (const n of adjacency.get(focusNode) ?? []) set.add(n)
      return set
    }
    if (focusEdge) {
      const e = placed.edges.find((x) => x.id === focusEdge)
      return e ? new Set([e.source, e.target]) : null
    }
    return null
  }, [focusNode, focusEdge, adjacency, placed])

  const isLit = useCallback((id) => !lit || lit.has(id), [lit])
  const edgeLit = useCallback(
    (e) => {
      if (focusEdge) return e.id === focusEdge
      if (!lit) return true
      return lit.has(e.source) && lit.has(e.target)
    },
    [lit, focusEdge],
  )

  /* ---- entrance choreography (once per dataset) --------------------------- */
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !placed.nodes.length) return undefined
    // Skip the entrance in a hidden tab: rAF is frozen there, so tweens that
    // start from autoAlpha 0 would leave the whole graph invisible.
    if (!canAnimateEntrance()) return undefined
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline()
      tl.fromTo(
        el.querySelectorAll('.kg-edge'),
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.45, stagger: 0.004, ease: 'power2.out' },
        0,
      ).fromTo(
        el.querySelectorAll('.kg-node'),
        { autoAlpha: 0, scale: 0.86, transformOrigin: '50% 50%' },
        { autoAlpha: 1, scale: 1, duration: 0.42, stagger: 0.012, ease: 'back.out(1.5)' },
        0.12,
      )
      return () => tl.progress(1).kill()
    })
    return () => mm.revert()
  }, [placed])

  /* ---- pan & zoom ---------------------------------------------------------- */
  const onWheel = useCallback((e) => {
    e.preventDefault()
    setView((v) => {
      const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.55, 3.2)
      return { ...v, k }
    })
  }, [])

  useEffect(() => {
    // Non-passive listener: React's onWheel is passive, so preventDefault()
    // there is ignored and the page scrolls behind the graph.
    const el = svgRef.current
    if (!el) return undefined
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onPointerDown = (e) => {
    if (e.target.closest('.kg-node, .kg-edge-hit')) return
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const scale = W / (svgRef.current?.getBoundingClientRect().width || W)
    setView((v) => ({
      ...v,
      x: d.ox + (e.clientX - d.x) * scale,
      y: d.oy + (e.clientY - d.y) * scale,
    }))
  }
  const endDrag = (e) => {
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  const resetView = () => setView({ k: 1, x: 0, y: 0 })

  /* ---- selection ----------------------------------------------------------- */
  const selectNode = (n) =>
    onSelect?.({ type: 'node', keys: [n.id], labels: { [n.id]: n.label }, node: n })

  const selectEdge = (e) =>
    onSelect?.({
      type: 'edge',
      edgeId: e.id,
      keys: [e.source, e.target],
      labels: { [e.source]: e.sourceLabel, [e.target]: e.targetLabel },
      edge: e,
    })

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') onSelect?.(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect])

  if (!placed.nodes.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-line"
        style={{ height }}
        role="status"
      >
        <p className="text-small font-light text-muted">
          No connections in this view yet — lower the link threshold to see weaker links.
        </p>
      </div>
    )
  }

  const reduced = prefersReducedMotion()
  const labelFor = (n) => truncate(n.label, n.r > 15 ? 20 : 14)

  return (
    <div ref={root} className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none rounded-xl"
        style={{ height, cursor: drag.current ? 'grabbing' : 'grab', background: graph.canvas }}
        role="application"
        aria-label={`Community knowledge graph: ${placed.nodes.length} entities, ${placed.edges.length} connections. Tab to an entity and press Enter for its briefing.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          if (e.target === svgRef.current) onSelect?.(null)
        }}
      >
        <defs>
          <radialGradient id="kg-vignette" cx="50%" cy="45%" r="72%">
            <stop offset="55%" stopColor={graph.canvas} stopOpacity="0" />
            <stop offset="100%" stopColor={graph.vignette} stopOpacity="0.045" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#kg-vignette)" pointerEvents="none" />

        <g
          transform={`translate(${W / 2} ${H / 2}) scale(${view.k}) translate(${-W / 2 + view.x} ${-H / 2 + view.y})`}
          style={{ transition: reduced ? 'none' : 'transform 220ms cubic-bezier(0.23,1,0.32,1)' }}
        >
          {/* --- edges --------------------------------------------------- */}
          {placed.edges.map((e) => {
            const on = edgeLit(e)
            const asserted = e.kind === 'asserted'
            const stroke = asserted ? colors.celeste : colors.blue
            const mx = (e.x1 + e.x2) / 2
            const my = (e.y1 + e.y2) / 2
            return (
              <g key={e.id} className="kg-edge">
                <line
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={stroke}
                  strokeWidth={asserted ? 1.6 : e.width}
                  strokeLinecap="round"
                  strokeDasharray={asserted ? '5 5' : undefined}
                  opacity={on ? (asserted ? 0.75 : 0.34) : 0.06}
                  style={{ transition: reduced ? 'none' : 'opacity 180ms ease-out' }}
                  pointerEvents="none"
                />
                {/* Fat invisible hit area — a 1px line is not a click target. */}
                <line
                  className="kg-edge-hit"
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: 'pointer' }}
                  onPointerEnter={() => setHover({ type: 'edge', id: e.id })}
                  onPointerLeave={() => setHover(null)}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    selectEdge(e)
                  }}
                >
                  <title>
                    {asserted
                      ? `${e.sourceLabel} — ${String(e.relation).replace(/_/g, ' ')} → ${e.targetLabel} (analyst, strength ${Number(e.weight).toFixed(2)})`
                      : `${e.sourceLabel} + ${e.targetLabel}: mentioned together in ${e.posts} posts`}
                  </title>
                </line>
                {asserted && (focusEdge === e.id || focusNode === e.source || focusNode === e.target) && (
                  <text
                    x={mx}
                    y={my - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill={graph.label}
                    stroke={graph.halo}
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                  >
                    {String(e.relation).replace(/_/g, ' ')}
                  </text>
                )}
              </g>
            )
          })}

          {/* --- nodes --------------------------------------------------- */}
          {placed.nodes.map((n) => {
            const on = isLit(n.id)
            const selected = selection?.keys?.includes(n.id)
            const style = kindStyle()[n.kind] ?? kindStyle().product
            return (
              <g
                key={n.id}
                className="kg-node"
                tabIndex={0}
                role="button"
                aria-label={`${style.label}: ${n.label}, ${n.weight} mentions, ${n.degree} connections`}
                style={{ cursor: 'pointer', outline: 'none' }}
                opacity={on ? 1 : 0.16}
                onPointerEnter={() => setHover({ type: 'node', id: n.id })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ type: 'node', id: n.id })}
                onBlur={() => setHover(null)}
                onClick={(ev) => {
                  ev.stopPropagation()
                  selectNode(n)
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    selectNode(n)
                  }
                }}
              >
                {selected && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r + 7}
                    fill="none"
                    stroke={style.fill}
                    strokeWidth={2}
                    opacity={0.45}
                  />
                )}
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={style.fill}
                  stroke={graph.halo}
                  strokeWidth={2}
                  style={{ transition: reduced ? 'none' : 'r 160ms cubic-bezier(0.23,1,0.32,1)' }}
                />
                {n.kind === 'concept' && (
                  <circle cx={n.x} cy={n.y} r={Math.max(n.r - 4, 2)} fill={graph.halo} opacity={0.55} />
                )}
                {showLabels && (on || n.r > 13) && (
                  <text
                    x={n.x}
                    y={n.y + n.r + 13}
                    textAnchor="middle"
                    fontSize={n.r > 15 ? 12 : 11}
                    fontWeight={selected || focusNode === n.id ? 600 : 400}
                    fill={graph.label}
                    stroke={graph.halo}
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    style={{ paintOrder: 'stroke', pointerEvents: 'none' }}
                  >
                    {labelFor(n)}
                  </text>
                )}
                <title>{`${style.label}: ${n.label} — ${n.weight} mentions, ${n.degree} connections`}</title>
              </g>
            )
          })}
        </g>
      </svg>

      {/* --- viewport controls ---------------------------------------------- */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1.5">
        {[
          ['Zoom in', '+', () => setView((v) => ({ ...v, k: clamp(v.k * 1.25, 0.55, 3.2) }))],
          ['Zoom out', '−', () => setView((v) => ({ ...v, k: clamp(v.k / 1.25, 0.55, 3.2) }))],
          ['Reset view', '⤾', resetView],
        ].map(([label, glyph, fn]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={fn}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-body text-ink hover:border-blue hover:text-blue transition-colors hover:border-blue hover:text-blue"
          >
            {glyph}
          </button>
        ))}
      </div>

      <div
        className="pointer-events-none absolute bottom-3 left-3 rounded-pill bg-surface/85 px-3 py-1 text-caption font-light text-muted backdrop-blur"
        aria-hidden="true"
      >
        Drag to pan · scroll to zoom · click an entity or a link
      </div>

      <p className="sr-only" aria-live="polite">
        {selection
          ? `Selected ${Object.values(selection.labels ?? {}).join(' and ')}`
          : 'Nothing selected'}
      </p>
    </div>
  )
}

/** Accessible, non-visual source of truth for the graph (a11y fallback). */
export function AdjacencyTable({ graph, onSelect, limit = 40 }) {
  const rows = useMemo(() => {
    const labels = new Map((graph?.nodes ?? []).map((n) => [n.id, n.label]))
    return [...(graph?.edges ?? [])]
      .sort((a, b) => (b.kind === 'asserted') - (a.kind === 'asserted') || b.weight - a.weight)
      .slice(0, limit)
      .map((e) => ({
        ...e,
        sourceLabel: labels.get(e.source) ?? e.source,
        targetLabel: labels.get(e.target) ?? e.target,
      }))
  }, [graph, limit])

  if (!rows.length) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">
          Every connection in the graph, strongest first — the accessible equivalent of the map.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-caption uppercase tracking-wide text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">From</th>
            <th scope="col" className="py-2 pr-4 font-medium">Relationship</th>
            <th scope="col" className="py-2 pr-4 font-medium">To</th>
            <th scope="col" className="py-2 text-right font-medium">Strength</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.id}
              className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-mist"
              onClick={() =>
                onSelect?.({
                  type: 'edge',
                  edgeId: e.id,
                  keys: [e.source, e.target],
                  labels: { [e.source]: e.sourceLabel, [e.target]: e.targetLabel },
                  edge: e,
                })
              }
            >
              <td className="py-2 pr-4 font-medium">{e.sourceLabel}</td>
              <td className="py-2 pr-4 font-light text-muted">
                {e.kind === 'asserted'
                  ? String(e.relation).replace(/_/g, ' ')
                  : 'mentioned together'}
              </td>
              <td className="py-2 pr-4 font-medium">{e.targetLabel}</td>
              <td className="py-2 text-right font-light tabular-nums text-muted">
                {e.kind === 'asserted'
                  ? `${Math.round(e.weight * 100)}% confidence`
                  : `${e.posts} posts`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

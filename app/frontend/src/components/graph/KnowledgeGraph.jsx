import { useCallback, useEffect, useMemo, useRef } from 'react'
import { colors, graph as graphTone, mode as currentMode } from '../../theme'
import { canAnimateEntrance } from '../../motion'
import { cytoscape, layoutOptions, relLabel, toElements } from './cytoGraph'
import { truncate } from './forceGraph'

/**
 * Interactive knowledge-graph canvas — Cytoscape.js + fcose edition.
 *
 * Why Cytoscape over the hand-rolled SVG: native pointer handling across
 * mouse / trackpad / touch (pinch-zoom, two-finger pan, tap, drag) with
 * zero custom gesture code, a canvas renderer that stays smooth well past
 * our node count, and built-in cursor states. ~120 lines of custom
 * pan/zoom/drag state collapse into the renderer.
 *
 * Preserved contracts (InsightPanel + Relationships depend on them):
 *   - kindStyle()      : live-palette getter ({fill,label} per kind)
 *   - selection shape  : {type:'node', keys, labels, node}
 *                        {type:'edge', edgeId, keys, labels, edge}
 *   - AdjacencyTable   : accessible list twin, unchanged
 *
 * Determinism: elements are seeded with a golden-angle spiral and fcose
 * runs with randomize:false — the same graph always settles to the same
 * picture, so people build a mental map of where things live.
 *
 * Motion rules (project skill): animations never gate content. The fcose
 * settle IS the entrance; with reduced motion or a hidden tab it runs
 * instantly with animate:false and the graph is simply there.
 */

/* Live palette getters (functions, not consts): colors/graph are live
 * bindings that change with the theme mode — a module-level const would
 * freeze light-mode fills into dark mode. */
export const kindStyle = () => ({
  product: { fill: colors.blue, label: 'Product' },
  person: { fill: graphTone.personFill, label: 'Person' },
  concept: { fill: colors.celeste, label: 'Analyst concept' },
})

/** Edge opacity at rest — co-mention lines are quiet until focused. */
const EDGE_REST = 0.34
/** Edge opacity when asserted (analyst layer) or focused. */
const EDGE_LIT = 0.75
/** Distant elements during a focus — visible, but out of the story. */
const DIM_NODE = 0.16
const DIM_EDGE = 0.08

/** Live Cytoscape stylesheet, rebuilt whenever the theme mode changes. */
function buildStyles(reduced) {
  const t = reduced ? 0 : 180
  return [
    {
      selector: 'core',
      style: {
        'active-bg-size': 0,
        'selection-box-border-color': 'transparent',
        'selection-box-background-color': 'transparent',
      },
    },
    {
      selector: 'node',
      style: {
        shape: 'ellipse',
        width: 'data(size)',
        height: 'data(size)',
        'background-color': 'data(fill)',
        'border-width': 2,
        'border-color': graphTone.halo,
        label: 'data(labelShort)',
        color: graphTone.label,
        'font-size': 'data(fsize)',
        'font-family': "'Poppins', system-ui, sans-serif",
        'font-weight': 400,
        'text-valign': 'bottom',
        'text-margin-y': 7,
        'text-halign': 'center',
        'text-wrap': 'ellipsis',
        'text-max-width': 96,
        'text-outline-color': graphTone.halo,
        'text-outline-width': 3.5,
        'text-outline-opacity': 1,
        'min-zoomed-font-size': 9,
        'z-index': 2,
        'transition-property': 'opacity background-color border-color',
        'transition-duration': t,
      },
    },
    {
      // Small nodes keep labels hidden until lit (old rule: on || r > 13).
      selector: 'node.sm',
      style: { 'text-opacity': 0 },
    },
    {
      selector: 'node.lit',
      style: { 'text-opacity': 1 },
    },
    {
      selector: 'node.dim',
      style: { opacity: DIM_NODE },
    },
    {
      selector: 'edge',
      style: {
        width: 'data(width)',
        'line-color': 'data(lineColor)',
        'line-style': 'data(lineStyle)',
        'curve-style': 'haystack',
        'haystack-radius': 0.4,
        opacity: EDGE_REST,
        'transition-property': 'opacity line-color width',
        'transition-duration': t,
        'z-index': 1,
      },
    },
    {
      selector: 'edge.k-as',
      style: {
        'line-style': 'dash',
        width: 1.6,
        opacity: EDGE_LIT,
        'z-index': 3,
      },
    },
    {
      selector: 'edge.dim',
      style: { opacity: DIM_EDGE },
    },
    {
      // Selection ring: a soft halo in the node's own colour (old SVG ring).
      selector: 'node:selected',
      style: {
        'border-width': 7,
        'border-color': 'data(fill)',
        'border-opacity': 0.45,
      },
    },
    {
      selector: 'node.hov',
      style: { 'font-weight': 600 },
    },
  ]
}

/** Stamp live theme colours + truncated labels onto element definitions. */
function decorate(els) {
  const ks = kindStyle()
  for (const n of els.nodes) {
    const st = ks[n.data.kind] ?? ks.product
    n.data.fill = st.fill
    n.data.kindLabel = st.label
    n.data.labelShort = truncate(n.data.label, n.data.size / 2 > 15 ? 20 : 14)
  }
  for (const e of els.edges) {
    e.data.lineColor = e.data.kind === 'asserted' ? colors.celeste : colors.blue
    e.data.lineStyle = e.data.kind === 'asserted' ? 'dash' : 'solid'
  }
  return els
}

export default function KnowledgeGraph({
  graph,
  selection,
  onSelect,
  height = 620,
  showLabels = true,
}) {
  const root = useRef(null)
  const cyRef = useRef(null)
  const layoutRef = useRef(null)
  const applyFocusRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  const elements = useMemo(() => toElements(graph), [graph])
  const counts = useMemo(
    () => ({ n: elements.nodes.length, e: elements.edges.length }),
    [elements],
  )

  /* ---- mount / data lifecycle -------------------------------------------- */
  useEffect(() => {
    const host = root.current
    if (!host || !counts.n) return undefined

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const cy = cytoscape({
      container: host,
      elements: decorate(structuredClone(elements)),
      style: buildStyles(reduced),
      layout: { name: 'null' },
      wheelSensitivity: 0.25,
      minZoom: 0.25,
      maxZoom: 3.5,
      pixelRatio: true,
      renderer: { name: 'canvas' },
    })
    cyRef.current = cy
    // Dev handle for e2e verification (prod builds tree-shake this away).
    if (import.meta.env?.DEV) window.__kg = cy

    /* Focus model (same semantics as the SVG version): hover lights a
     * neighbourhood transiently; an explicit selection wins; everything
     * else dims but never disappears. */
    const neighbourLit = (id) => {
      const set = new Set([id])
      cy
        .getElementById(id)
        .connectedEdges()
        .connectedNodes()
        .forEach((nb) => set.add(nb.id()))
      return set
    }
    const applyFocus = (nodeId, edgeId) => {
      cy.batch(() => {
        cy.elements().removeClass('dim lit')
        if (nodeId) {
          const lit = neighbourLit(nodeId)
          cy.nodes().forEach((n) => (lit.has(n.id()) ? n.addClass('lit') : n.addClass('dim')))
          cy.edges().forEach((e) => {
            const on = lit.has(e.source().id()) && lit.has(e.target().id())
            if (!on) e.addClass('dim')
          })
        } else if (edgeId) {
          const edge = cy.getElementById(edgeId)
          if (edge.nonempty()) {
            const s = edge.source().id()
            const t = edge.target().id()
            cy.nodes().forEach((n) =>
              n.id() === s || n.id() === t ? n.addClass('lit') : n.addClass('dim'),
            )
            cy.edges().forEach((x) => {
              if (x.id() !== edgeId) x.addClass('dim')
            })
          }
        }
      })
    }
    applyFocusRef.current = applyFocus

    /* Selection payloads — the exact shapes the SVG version emitted. */
    const payload = (nodeEle) => ({
      type: 'node',
      keys: [nodeEle.id()],
      labels: { [nodeEle.id()]: nodeEle.data('label') },
      node: {
        id: nodeEle.id(),
        label: nodeEle.data('label'),
        kind: nodeEle.data('kind'),
        weight: nodeEle.data('weight'),
        degree: nodeEle.data('degree'),
        description: nodeEle.data('description'),
        meta: nodeEle.data('meta'),
      },
    })
    const edgePayload = (e) => ({
      type: 'edge',
      edgeId: e.id(),
      keys: [e.source().id(), e.target().id()],
      labels: {
        [e.source().id()]: e.source().data('label'),
        [e.target().id()]: e.target().data('label'),
      },
      edge: {
        id: e.id(),
        kind: e.data('kind'),
        relation: e.data('relation'),
        weight: e.data('weight'),
        posts: e.data('posts'),
        insightId: e.data('insightId'),
        source: e.source().id(),
        target: e.target().id(),
        sourceLabel: e.source().data('label'),
        targetLabel: e.target().data('label'),
        width: e.data('width'),
      },
    })

    cy.on('tap', 'node', (evt) => {
      const p = payload(evt.target)
      applyFocus(p.keys[0], null)
      onSelectRef.current?.(p)
    })
    cy.on('tap', 'edge', (evt) => {
      const p = edgePayload(evt.target)
      applyFocus(null, p.edgeId)
      onSelectRef.current?.(p)
    })
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        applyFocus(null, null)
        onSelectRef.current?.(null)
      }
    })

    /* Hover focus — pointer devices only. On tap-triggered mouseover
     * emulation (some mobile browsers), selection already applied it. */
    const restoreToSelection = () => {
      const sel = selectionRef.current
      if (sel?.type === 'node' && cy.getElementById(sel.keys[0]).nonempty()) {
        applyFocus(sel.keys[0], null)
      } else if (sel?.type === 'edge' && cy.getElementById(sel.edgeId).nonempty()) {
        applyFocus(null, sel.edgeId)
      } else {
        applyFocus(null, null)
      }
    }
    cy.on('mouseover', 'node', (evt) => {
      evt.target.addClass('hov')
      applyFocus(evt.target.id(), null)
    })
    cy.on('mouseover', 'edge', (evt) => applyFocus(null, evt.target.id()))
    cy.on('mouseout', 'node', (evt) => {
      evt.target.removeClass('hov')
      restoreToSelection()
    })
    cy.on('mouseout', 'edge', () => restoreToSelection())

    /* Escape clears selection (keyboard parity with the SVG version). The
     * canvas itself is not tabbable — the AdjacencyTable list twin carries
     * keyboard/AT access, as before. */
    const onKey = (ev) => {
      if (ev.key === 'Escape') onSelectRef.current?.(null)
    }
    window.addEventListener('keydown', onKey)

    /* Tooltip (canvas has no <title>): follows the pointer, mirrors the
     * old SVG title text — kind, mentions, connections / pair + posts. */
    const tip = document.createElement('div')
    tip.setAttribute('role', 'tooltip')
    tip.style.cssText =
      'position:fixed;z-index:50;pointer-events:none;opacity:0;transition:opacity 120ms ease-out;' +
      'border-radius:8px;padding:6px 10px;font:400 12px/1.45 Poppins,system-ui,sans-serif;' +
      'max-width:260px;box-shadow:0 8px 24px rgba(0,0,0,.18);white-space:nowrap;'
    const tipFor = (ele) => {
      if (ele.isNode()) {
        return `${ele.data('kindLabel')}: ${ele.data('label')} — ${ele.data('weight')} mentions, ${ele.data('degree')} connections`
      }
      const e = ele
      return e.data('kind') === 'asserted'
        ? `${e.source().data('label')} — ${relLabel(e.data('relation'))} → ${e.target().data('label')} (analyst, strength ${Number(e.data('weight')).toFixed(2)})`
        : `${e.source().data('label')} + ${e.target().data('label')}: mentioned together in ${e.data('posts')} posts`
    }
    const moveTip = (evt) => {
      const { clientX: x, clientY: y } = evt.originalEvent ?? evt
      tip.style.left = `${Math.min(x + 14, window.innerWidth - 270)}px`
      tip.style.top = `${y + 16}px`
    }
    const showTip = (evt) => {
      tip.textContent = tipFor(evt.target)
      tip.style.background = getComputedStyle(host).backgroundColor
      tip.style.color = graphTone.label
      tip.style.border = `1px solid ${colors.blue}33`
      tip.style.opacity = '1'
      moveTip(evt)
    }
    cy.on('mouseover', 'node', (evt) => showTip(evt))
    cy.on('mouseover', 'edge', (evt) => showTip(evt))
    cy.on('mousemove', 'node', (evt) => moveTip(evt))
    cy.on('mousemove', 'edge', (evt) => moveTip(evt))
    cy.on('mouseout', 'node', () => {
      tip.style.opacity = '0'
    })
    cy.on('mouseout', 'edge', () => {
      tip.style.opacity = '0'
    })
    document.body.appendChild(tip)
    // On touch there is no hover: show the tip briefly at the tap point.
    cy.on('tap', 'node', (evt) => {
      showTip(evt)
      window.setTimeout(() => {
        tip.style.opacity = '0'
      }, 1600)
    })
    cy.on('tap', 'edge', (evt) => {
      showTip(evt)
      window.setTimeout(() => {
        tip.style.opacity = '0'
      }, 1600)
    })

    /* Entrance = the fcose settle itself (once per dataset). Reduced motion
     * or a hidden tab runs it instantly so content never waits on an
     * animation (project hard rule). */
    layoutRef.current?.stop()
    const l = cy.layout(layoutOptions(true && canAnimateEntrance()))
    layoutRef.current = l
    l.run()

    const ro = new ResizeObserver(() => cy.resize())
    ro.observe(host)

    return () => {
      window.removeEventListener('keydown', onKey)
      tip.remove()
      ro.disconnect()
      layoutRef.current?.stop()
      cy.destroy()
      cyRef.current = null
      applyFocusRef.current = null
    }
  }, [elements, counts.n])

  /* ---- theme switch: repaint palette in place ---------------------------- */
  const prevMode = useRef(currentMode)
  useEffect(() => {
    if (prevMode.current === currentMode) return
    prevMode.current = currentMode
    const cy = cyRef.current
    if (!cy) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    cy.style().fromJson(buildStyles(reduced)).update()
    cy.batch(() => {
      const ks = kindStyle()
      cy.nodes().forEach((n) => {
        const st = ks[n.data('kind')] ?? ks.product
        n.data({
          fill: st.fill,
          labelShort: showLabels
            ? truncate(n.data('label'), n.data('size') / 2 > 15 ? 20 : 14)
            : '',
        })
      })
      cy.edges().forEach((e) => {
        e.data({
          lineColor: e.data('kind') === 'asserted' ? colors.celeste : colors.blue,
          lineStyle: e.data('kind') === 'asserted' ? 'dash' : 'solid',
        })
      })
    })
  })

  /* ---- external selection (list rows, panel chips) ------------------------ */
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !cy.nodes().nonempty()) return
    cy.elements().unselect()
    const id = selection?.keys?.[0]
    if (id && cy.getElementById(id).nonempty()) {
      cy.getElementById(id).select()
      if (selection.type === 'node') applyFocusRef.current?.(id, null)
      else if (selection.type === 'edge' && selection.edgeId)
        applyFocusRef.current?.(null, selection.edgeId)
    } else {
      applyFocusRef.current?.(null, null)
    }
  }, [selection])

  /* ---- viewport controls --------------------------------------------------- */
  const zoomBy = useCallback((factor) => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: Math.max(0.25, Math.min(3.5, cy.zoom() * factor)),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }, [])
  const resetView = useCallback(() => {
    cyRef.current?.fit(undefined, 46)
  }, [])

  if (!counts.n) {
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

  return (
    <div className="relative">
      <div
        ref={root}
        className="w-full touch-none select-none rounded-xl"
        style={{ height, background: graphTone.canvas }}
        role="application"
        aria-label={`Community knowledge graph: ${counts.n} entities, ${counts.e} connections. Use the connections list below for keyboard access.`}
      />

      {/* --- viewport controls -------------------------------------------- */}
      <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1.5">
        {[
          ['Zoom in', '+', () => zoomBy(1.25)],
          ['Zoom out', '−', () => zoomBy(1 / 1.25)],
          ['Reset view', '⤾', resetView],
        ].map(([label, glyph, fn]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={fn}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-body text-ink transition-colors hover:border-blue hover:text-blue"
          >
            {glyph}
          </button>
        ))}
      </div>

      <div
        className="pointer-events-none absolute bottom-3 left-3 rounded-pill bg-surface/85 px-3 py-1 text-caption font-light text-muted backdrop-blur"
        aria-hidden="true"
      >
        Drag to pan · scroll or pinch to zoom · tap an entity or a link
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

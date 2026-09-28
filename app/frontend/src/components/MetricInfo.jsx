import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { gsap, canAnimateEntrance } from '../motion'
import { METRIC_INFO, buildGraph } from '../metricInfo'
import RelationshipMap from './charts/RelationshipMap'

const PANEL_W = 320
const MARGIN = 8

/**
 * The "what is this?" affordance used on every card, chart and page heading.
 *
 * The panel is rendered through a portal onto <body>. That is deliberate: the
 * cards it sits inside get a GSAP hover lift (`transform: translateY`), and a
 * transformed element starts a new stacking context — inside one, no z-index
 * can lift the panel above the next card. Tables add `overflow-x-auto`, which
 * would clip it too. A portal escapes both in one move.
 */
export default function MetricInfo({ metricKey, accent, className = '' }) {
  // The same metricKey can appear many times on one page (every pain-point
  // card shares `painPointItem`), so the DOM ids are per-instance — duplicate
  // ids would break aria-controls and make the outside-click test ambiguous.
  // useId yields ":r1:" — the colons are illegal in a CSS selector, and these
  // ids are fed to closest(), so strip them.
  const uid = useId().replace(/:/g, '')
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const closeTimer = useRef(null)
  const info = METRIC_INFO[metricKey]

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 200)
  }

  /** Anchor under the button, flip above when short of room, clamp to viewport. */
  const place = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const h = panelRef.current?.offsetHeight ?? 320
    const left = Math.min(Math.max(r.right - PANEL_W, MARGIN), window.innerWidth - PANEL_W - MARGIN)
    const below = r.bottom + MARGIN
    const top = below + h > window.innerHeight - MARGIN ? Math.max(MARGIN, r.top - h - MARGIN) : below
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }))
  }, [])

  // Position before paint, then keep it pinned while the page moves.
  useLayoutEffect(() => {
    if (!open) return undefined
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return undefined
    const el = panelRef.current
    // A hidden tab freezes rAF, so a tween starting at autoAlpha 0 would
    // leave the tooltip permanently blank. Show it as-is instead.
    if (!canAnimateEntrance()) {
      gsap.set(el, { autoAlpha: 1, y: 0 })
      gsap.set(el.querySelectorAll('[data-sec]'), { autoAlpha: 1, y: 0 })
      return undefined
    }
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline()
      tl.fromTo(el, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.3 })
      tl.fromTo(
        el.querySelectorAll('[data-sec]'),
        { autoAlpha: 0, y: 4 },
        { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.06 },
        0,
      )
      // progress(1) before kill so a tooltip reopened mid-fade is fully
      // visible rather than stranded at autoAlpha 0.
      return () => tl.progress(1).kill()
    })
    return () => mm.revert()
  }, [open])

  useLayoutEffect(() => {
    if (!open) return undefined
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const handlePointerDown = (e) => {
      if (!e.target.closest(`#info-panel-${uid}`) && !e.target.closest(`#info-btn-${uid}`)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [open, uid])

  useLayoutEffect(() => () => cancelClose(), [])

  if (!info) return null

  const id = `info-panel-${uid}`
  const btnId = `info-btn-${uid}`
  const graph = buildGraph(metricKey)

  const panel = (
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      // z-[100] on a <body> child: above the sidebar (z-50) and every card.
      className="fixed z-[100] w-[320px] rounded-xl border border-line bg-white p-4 text-left font-sans shadow-md"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-4">
        <div data-sec="what">
          <h4 className="text-caption font-semibold" style={{ color: accent }}>What is this?</h4>
          <p className="mt-1 break-words text-small text-muted">{info.what}</p>
        </div>
        <div data-sec="how">
          <h4 className="text-caption font-semibold" style={{ color: accent }}>How is it worked out?</h4>
          <p className="mt-1 break-words text-small text-muted">{info.how}</p>
        </div>
        <div data-sec="fresh">
          <h4 className="text-caption font-semibold" style={{ color: accent }}>How fresh is it?</h4>
          <p className="mt-1 break-words text-small text-muted">{info.fresh}</p>
        </div>
        {graph.nodes.length > 0 && (
          <div data-sec="map">
            <h4 className="text-caption font-semibold" style={{ color: accent }}>Related metrics</h4>
            <div className="mt-1 flex justify-center">
              <RelationshipMap graph={graph} width={288} height={210} pad={58} />
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      onMouseEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose()
        setOpen(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={btnRef}
        id={btnId}
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-blue hover:text-blue focus:outline-none"
        aria-label={`About ${info.title}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open && createPortal(panel, document.body)}
    </span>
  )
}

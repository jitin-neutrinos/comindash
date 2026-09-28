import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import logoSymbol from '../brand/logo/neutrinos-symbol-white.png'
import { NAV } from './Header'
import { gsap, prefersReducedMotion } from '../motion'

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

/* 16px line icons — one per section; stroke follows currentColor. Rendered
 * at 20px in the rail (see the [&>svg] size override on the wrapper span). */
const ICONS = {
  '/': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2.25" y="2.25" width="4.75" height="4.75" rx="1.2" {...stroke} />
      <rect x="9" y="2.25" width="4.75" height="4.75" rx="1.2" {...stroke} />
      <rect x="2.25" y="9" width="4.75" height="4.75" rx="1.2" {...stroke} />
      <rect x="9" y="9" width="4.75" height="4.75" rx="1.2" {...stroke} />
    </svg>
  ),
  '/metrics': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M2.5 13.5h11" {...stroke} />
      <path d="m3.5 10 3-3.5 2.5 2 3.5-4" {...stroke} />
      <path d="M9.7 4.5h3v3" {...stroke} />
    </svg>
  ),
  '/insights': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M8 2.75 14.25 13.25H1.75Z" {...stroke} />
      <path d="M8 6.75v2.75" {...stroke} />
      <circle cx="8" cy="11.6" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  ),
  '/relationships': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <circle cx="3.75" cy="4" r="2" {...stroke} />
      <circle cx="12.25" cy="6.5" r="2" {...stroke} />
      <circle cx="6.25" cy="12" r="2" {...stroke} />
      <path d="m5.4 5 4.8 1.1M4.9 5.9l.9 4.2M11 8.3 8 10.5" {...stroke} />
    </svg>
  ),
  '/explorer': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" {...stroke} />
      <path d="M2.25 6.5h11.5M6 6.5v6.25" {...stroke} />
    </svg>
  ),
  '/admin': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M8 2a6 6 0 100 12 6 6 0 000-12zM8 5v6M5 8h6" {...stroke} />
    </svg>
  ),
}

/* Settings gear — same minimal line style, kept separate from ICONS since it
 * sits below the main section list, not in it. */
const GEAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
    <circle cx="8" cy="8" r="4.6" {...stroke} />
    <circle cx="8" cy="8" r="1.8" {...stroke} />
    <line x1="12.6" y1="8" x2="14.3" y2="8" {...stroke} />
    <line x1="11.253" y1="11.253" x2="12.455" y2="12.455" {...stroke} />
    <line x1="8" y1="12.6" x2="8" y2="14.3" {...stroke} />
    <line x1="4.747" y1="11.253" x2="3.545" y2="12.455" {...stroke} />
    <line x1="3.4" y1="8" x2="1.7" y2="8" {...stroke} />
    <line x1="4.747" y1="4.747" x2="3.545" y2="3.545" {...stroke} />
    <line x1="8" y1="3.4" x2="8" y2="1.7" {...stroke} />
    <line x1="11.253" y1="4.747" x2="12.455" y2="3.545" {...stroke} />
  </svg>
)

/**
 * Fixed-width (80px) full-height Midnight Blue icon rail — logo mark on top,
 * then one tile per section: icon above a single-line (truncated) label
 * below it. This is the only sidebar state there is; it never widens into a
 * labelled 240px rail. On viewports under 1024px it still slides on/off
 * canvas as a drawer (same narrow width), which is a responsiveness need,
 * not the old expand/collapse feature — that toggle has been removed.
 */
export default function Sidebar({ open, onClose }) {
  const panel = useRef(null)
  const backdrop = useRef(null)
  const pill = useRef(null)
  const nav = useRef(null)
  const closeBtn = useRef(null)
  const first = useRef(true)
  const firstPill = useRef(true)
  const location = useLocation()

  /* Off-canvas position (mobile) — GSAP-driven, synced with viewport. */
  useLayoutEffect(() => {
    const el = panel.current
    const bd = backdrop.current
    const mq = window.matchMedia('(min-width: 1024px)')
    const reduced = prefersReducedMotion()
    let tween

    const render = (animate) => {
      tween?.kill()
      const shown = mq.matches || open
      const drawerOpen = !mq.matches && open
      const dur = animate && !reduced ? 0.25 : 0
      // autoAlpha keeps the hidden drawer out of the tab order (visibility)
      tween = gsap.to(el, {
        xPercent: shown ? 0 : -100,
        autoAlpha: shown ? 1 : 0,
        duration: dur,
        ease: 'power3.out',
      })
      if (bd) {
        gsap.to(bd, { autoAlpha: drawerOpen ? 1 : 0, duration: dur ? 0.2 : 0 })
      }
      document.body.style.overflow = drawerOpen ? 'hidden' : ''
    }

    const onViewportChange = () => render(true)
    render(!first.current)
    first.current = false
    mq.addEventListener('change', onViewportChange)
    return () => {
      mq.removeEventListener('change', onViewportChange)
      tween?.kill()
      document.body.style.overflow = ''
    }
  }, [open])

  /* Celeste pill indicator slides to the active nav item (aria-current
   * marks the active NavLink; measuring the anchor keeps the pill at the
   * link's full box, whatever shape that tile is). */
  useLayoutEffect(() => {
    const container = nav.current
    const pillEl = pill.current
    if (!container || !pillEl) return
    const active = container.querySelector('a[aria-current="page"]')
    if (!active) {
      gsap.set(pillEl, { autoAlpha: 0 })
      return
    }
    const place = {
      autoAlpha: 1,
      x: active.offsetLeft,
      y: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
    }
    if (firstPill.current || prefersReducedMotion()) gsap.set(pillEl, place)
    else gsap.to(pillEl, { ...place, duration: 0.2, ease: 'power3.out' })
    firstPill.current = false
  }, [location.pathname])

  /* Escape closes the drawer and returns focus to the header toggle. */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      onClose()
      document.querySelector('[aria-label="Toggle navigation"]')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const link = ({ isActive }) =>
    `relative z-10 mx-1 flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-center transition-colors ${
      isActive ? 'text-white drop-shadow-[0_0_8px_rgba(0,102,255,0.55)]' : 'text-white/60 hover:bg-white/5 hover:text-white'
    }`

  // One hairline between tiles (not a border on each tile, which stacked two
  // lines at every seam) — a plain sibling `div`, so it never sits inside the
  // active-item pill's box and can't be clipped by it. Celeste at 35% reads
  // clearly against Midnight Blue; the 15% tried earlier was too faint.
  const Divider = () => <div aria-hidden="true" className="h-px w-16 shrink-0 bg-celeste/35" />

  return (
    <>
      <div
        ref={backdrop}
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-midnight/50 lg:hidden"
        style={{ opacity: 0, visibility: 'hidden' }}
      />
      <aside
        ref={panel}
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-50 flex w-20 shrink-0 flex-col bg-midnight px-2 pb-6"
      >
        {/* Brand mark — symbol only (the narrow rail is the only state now). */}
        <Link
          to="/"
          onClick={onClose}
          aria-label="Neutrinos — go to overview"
          className="flex items-center justify-center pb-4 pt-4"
        >
          <img src={logoSymbol} alt="Neutrinos" className="h-[50px] w-[50px]" />
        </Link>
        {/* Drawer close (mobile only — on desktop the rail is persistent) */}
        <div className="flex items-center justify-center pb-1 lg:hidden">
          <button
            ref={closeBtn}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-pill p-2 text-white/80 transition-all duration-150 hover:bg-white/10 hover:text-white active:scale-[0.95]"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          ref={nav}
          className="relative flex flex-1 flex-col items-center gap-1 overflow-y-auto py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {/* Celeste active-item pill (slides between nav items) */}
          <div
            ref={pill}
            aria-hidden="true"
            className="absolute left-0 top-0 z-0 rounded-[10px] bg-blue/15 border border-blue/35 shadow-[0_0_15px_rgba(0,102,255,0.25)] backdrop-blur-sm"
            style={{ opacity: 0 }}
          />
          <Divider />
          {NAV.map((item) => (
            <Fragment key={item.to}>
              <NavLink to={item.to} end={item.end} className={link} onClick={onClose} title={item.label}>
                <span className="[&>svg]:h-5 [&>svg]:w-5">{ICONS[item.to]}</span>
                <span className="w-full text-[10px] font-medium leading-tight truncate">{item.label}</span>
              </NavLink>
              <Divider />
            </Fragment>
          ))}
        </div>
        <div className="mt-2 flex justify-center border-t border-white/10 pt-2">
          <NavLink
            to="/settings"
            onClick={onClose}
            title="Settings"
            className={({ isActive }) =>
              `flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-center transition-colors ${
                isActive ? 'text-white drop-shadow-[0_0_8px_rgba(0,102,255,0.55)]' : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <span className="[&>svg]:h-5 [&>svg]:w-5">{GEAR_ICON}</span>
            <span className="w-full text-[10px] font-medium leading-tight truncate">Settings</span>
          </NavLink>
        </div>
      </aside>
    </>
  )
}

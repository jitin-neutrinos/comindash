import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'
import logoSymbolColor from '../brand/logo/neutrinos-symbol-color.png'
import { NAV } from './Header'
import { gsap, prefersReducedMotion } from '../motion'
import { useMode } from '../theme'
import ThemeToggle from './ThemeToggle'

/* 16px FILLED icons — one per section (2026-09-28: user preference, filled
 * over outline in BOTH modes). Fill follows currentColor; secondary shapes
 * carry opacity so each glyph still reads as one mark. Rendered at 20px via
 * the [&>svg] size override on the wrapper span. */
const ICONS = {
  '/': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="2.2" y="2.2" width="5.1" height="5.1" rx="1.5" fill="currentColor" />
      <rect x="8.7" y="2.2" width="5.1" height="5.1" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="2.2" y="8.7" width="5.1" height="5.1" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="8.7" y="8.7" width="5.1" height="5.1" rx="1.5" fill="currentColor" />
    </svg>
  ),
  '/metrics': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="2.4" y="8.6" width="2.7" height="5" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="6.65" y="5.6" width="2.7" height="8" rx="1" fill="currentColor" />
      <rect x="10.9" y="2.4" width="2.7" height="11.2" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  '/insights': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <mask id="nav-insights-m">
        <rect width="16" height="16" fill="white" />
        <rect x="7.25" y="6.1" width="1.5" height="3.6" rx="0.75" fill="black" />
        <circle cx="8" cy="11.85" r="0.85" fill="black" />
      </mask>
      <path
        d="M8 2.3 14.15 13.4H1.85Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        mask="url(#nav-insights-m)"
      />
    </svg>
  ),
  '/relationships': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        d="M3.9 3.9 12.1 6.3M3.9 3.9 6.4 12.1M12.1 6.3 6.4 12.1"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="3.9" cy="3.9" r="2.1" fill="currentColor" />
      <circle cx="12.1" cy="6.3" r="1.75" fill="currentColor" opacity="0.6" />
      <circle cx="6.4" cy="12.1" r="1.9" fill="currentColor" opacity="0.6" />
    </svg>
  ),
  '/explorer': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <rect x="2.2" y="3" width="11.6" height="9.8" rx="1.6" fill="currentColor" opacity="0.25" />
      <rect x="2.2" y="3" width="11.6" height="2.9" rx="1.4" fill="currentColor" />
      <rect x="4.1" y="7.5" width="4.6" height="1.4" rx="0.7" fill="currentColor" opacity="0.85" />
      <rect x="4.1" y="10" width="2.8" height="1.4" rx="0.7" fill="currentColor" opacity="0.5" />
    </svg>
  ),
  '/admin': (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <mask id="nav-admin-m">
        <rect width="16" height="16" fill="white" />
        <rect x="7.15" y="4.6" width="1.7" height="6.8" rx="0.85" fill="black" />
        <rect x="4.6" y="7.15" width="6.8" height="1.7" rx="0.85" fill="black" />
      </mask>
      <circle cx="8" cy="8" r="5.9" fill="currentColor" mask="url(#nav-admin-m)" />
    </svg>
  ),
}

/* Settings gear — filled: solid wheel with a knocked-out hub, teeth drawn
 * as round-capped strokes inside the same mask group. */
const GEAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <mask id="nav-gear-m">
      <rect width="16" height="16" fill="white" />
      <circle cx="8" cy="8" r="2.1" fill="black" />
    </mask>
    <g mask="url(#nav-gear-m)">
      <circle cx="8" cy="8" r="4.6" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
        <line x1="8" y1="1.7" x2="8" y2="3.9" />
        <line x1="8" y1="12.1" x2="8" y2="14.3" />
        <line x1="1.7" y1="8" x2="3.9" y2="8" />
        <line x1="12.1" y1="8" x2="14.3" y2="8" />
        <line x1="3.5" y1="3.5" x2="5.1" y2="5.1" />
        <line x1="10.9" y1="10.9" x2="12.5" y2="12.5" />
        <line x1="3.5" y1="12.5" x2="5.1" y2="10.9" />
        <line x1="10.9" y1="5.1" x2="12.5" y2="3.5" />
      </g>
    </g>
  </svg>
)

/**
 * Fixed-width (80px) full-height icon rail — logo mark on top, then one tile
 * per section: icon above a single-line (truncated) label below it. This is
 * the only sidebar state there is; it never widens into a labelled 240px
 * rail. On viewports under 1024px it slides on/off canvas as a drawer (same
 * narrow width), closed by the backdrop, Escape, or navigating — no in-panel
 * close button (removed 2026-09-28 by user request).
 *
 * Rail surface follows the mode (2026-09-28): Midnight Blue with white marks
 * in light mode; WHITE with Neutrinos-blue marks + colour logo in dark mode.
 * Colors are explicit literals (not theme tokens) because the rail is its
 * own surface — e.g. `text-blue` would get lifted to #4D94FF by the dark
 * `.text-blue` override, which fails contrast on a white rail.
 */
export default function Sidebar({ open, onClose }) {
  const m = useMode()
  const dark = m === 'dark'
  const panel = useRef(null)
  const backdrop = useRef(null)
  const pill = useRef(null)
  const nav = useRef(null)
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

  /* Blue pill indicator slides to the active nav item (aria-current
   * marks the active NavLink; measuring the anchor keeps the pill at the
   * link's full box, whatever shape that tile is). Re-measures on mode
   * change too, in case tile metrics shift with the surface swap. */
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
  }, [location.pathname, m])

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

  /* Tile styling per mode. Active/ink pairs chosen for ≥4.5:1 on the rail:
   * light rail — white on midnight; dark-mode rail — #0066FF / #0052CC on
   * white (4.83:1 / 6.6:1). */
  const tile = (isActive) => {
    const base =
      'flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-center transition-colors'
    if (dark) {
      return isActive
        ? `${base} text-[#0066FF] drop-shadow-[0_0_8px_rgba(0,102,255,0.4)]`
        : `${base} text-[#0052CC] hover:bg-[#0066FF]/[0.06] hover:text-[#0066FF]`
    }
    return isActive
      ? `${base} text-white drop-shadow-[0_0_8px_rgba(0,102,255,0.55)]`
      : `${base} text-white/60 hover:bg-white/5 hover:text-white`
  }
  const link = ({ isActive }) => `relative z-10 mx-1 ${tile(isActive)}`

  // One hairline between tiles (not a border on each tile, which stacked two
  // lines at every seam) — a plain sibling `div`, so it never sits inside the
  // active-item pill's box and can't be clipped by it.
  const Divider = () => (
    <div
      aria-hidden="true"
      className={`h-px w-16 shrink-0 ${dark ? 'bg-[#0066FF]/20' : 'bg-celeste/35'}`}
    />
  )

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
        className={`fixed inset-y-0 left-0 z-50 flex w-20 shrink-0 flex-col px-2 pb-6 ${
          dark ? 'border-r border-[#E6EAF0] bg-white' : 'bg-midnight'
        }`}
      >
        {/* Brand mark — symbol only (the narrow rail is the only state).
         * Colour symbol on the white dark-mode rail, white on midnight. */}
        <Link
          to="/"
          onClick={onClose}
          aria-label="Neutrinos — go to overview"
          className="flex items-center justify-center pb-4 pt-4"
        >
          <img
            src={dark ? logoSymbolColor : logoSymbolWhite}
            alt="Neutrinos"
            className="h-[50px] w-[50px]"
          />
        </Link>
        <div
          ref={nav}
          className="relative flex flex-1 flex-col items-center gap-1 overflow-y-auto py-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          {/* Blue active-item pill (slides between nav items) — translucent
           * brand blue works on both the midnight and the white rail. */}
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
        {/* Theme toggle — directly above Settings; per-mode rail styling. */}
        <div className={`mt-2 flex justify-center border-t pt-2 ${dark ? 'border-[#0066FF]/15' : 'border-white/10'}`}>
          <ThemeToggle dark={dark} />
        </div>
        <div className={`mt-1 flex justify-center border-t pt-2 ${dark ? 'border-[#0066FF]/15' : 'border-white/10'}`}>
          <NavLink
            to="/settings"
            onClick={onClose}
            title="Settings"
            className={({ isActive }) => tile(isActive)}
          >
            <span className="[&>svg]:h-5 [&>svg]:w-5">{GEAR_ICON}</span>
            <span className="w-full text-[10px] font-medium leading-tight truncate">Settings</span>
          </NavLink>
        </div>
      </aside>
    </>
  )
}

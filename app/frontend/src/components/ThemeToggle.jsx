// ThemeToggle — dark/light switch with a premium swipe reveal.
//
// Two coordinated animation layers:
//   1. FULL-PAGE WIPE — View Transitions API circular clip-path expanding
//      from this button (adapted from Magic UI's animated-theme-toggler,
//      MIT: https://magicui.design — percentage-based clip so fractional
//      display scales stay correct; WAAPI drives ::view-transition-new(root)
//      after ready). Browsers without VT (Firefox today) fall back to a CSS
//      cross-fade via the `theme-fading` class in index.css.
//   2. ICON MORPH — GSAP sun↔moon: the moon is the sun's circle with a
//      masking circle that slides diagonally out (waning) or in (waxing),
//      plus ray rotation/scale — reads as one continuous celestial object,
//      not two icons swapping. Reduced motion snaps without animation.
//
// Rules honored (project skill): animations never gate content — the toggle
// state itself is applied synchronously inside startViewTransition's
// flushSync callback; an interrupted/killed wipe leaves the correct theme.
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { gsap, prefersReducedMotion } from '../motion'
import { mode as currentMode, setMode, useMode } from '../theme'

const WIPE_MS = 550
/* Circle radius percentages resolve against hypot(w,h)/√2 of the snapshot
 * box (Magic UI #989 note) — compute the exact % for full coverage. */
const radiusPct = (x, y, w, h) => {
  const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y))
  return (r / (Math.hypot(w, h) / Math.SQRT2)) * 100
}

export default function ThemeToggle({ dark: railIsWhite = false }) {
  const m = useMode()
  const [busy, setBusy] = useState(false)
  const btn = useRef(null)
  const iconWrap = useRef(null)
  const maskRef = useRef(null)
  const raysRef = useRef(null)
  const coreRef = useRef(null)

  /* Icon morph — runs whenever mode changes (also on first mount paint after
   * the boot script, where it animates from the light default to dark). */
  useEffect(() => {
    const wrap = iconWrap.current
    if (!wrap) return undefined
    const dark = m === 'dark'
    const reduced = prefersReducedMotion()
    const tweens = []
    if (maskRef.current) {
      tweens.push(
        gsap.to(maskRef.current, {
          attr: { cx: dark ? 15.4 : 20, cy: dark ? 6.6 : 6 },
          duration: reduced ? 0 : 0.8,
          ease: 'power3.inOut',
        }),
      )
    }
    if (raysRef.current) {
      // Rays recede into the core as the moon waxes; rotate 90° en route.
      tweens.push(
        gsap.to(raysRef.current, {
          scale: dark ? 0.3 : 1,
          opacity: dark ? 0 : 1,
          rotate: dark ? 90 : 0,
          transformOrigin: '12.5px 12.5px',
          duration: reduced ? 0 : 0.5,
          ease: 'power2.inOut',
        }),
      )
    }
    if (coreRef.current) {
      tweens.push(
        gsap.to(coreRef.current, {
          attr: { r: dark ? 8.4 : 6.9 },
          duration: reduced ? 0 : 0.5,
          ease: 'power2.inOut',
        }),
      )
    }
    return () => {
      // Motion-guard rule: land a killed tween on its END state so an
      // interrupted morph never leaves the icon mid-transition.
      tweens.forEach((tw) => tw.progress(1).kill())
    }
  }, [m])

  const toggle = useCallback(() => {
    const button = btn.current
    if (!button || busy) return
    const next = currentMode === 'dark' ? 'light' : 'dark'

    const apply = () => {
      flushSync(() => setMode(next))
    }

    const reduce = prefersReducedMotion()
    if (reduce || typeof document.startViewTransition !== 'function') {
      // Reduced motion, or no View Transitions (Firefox): plain flip, plus a
      // short CSS cross-fade layer on non-VT browsers that allow motion.
      if (!reduce) {
        const root = document.documentElement
        root.classList.add('theme-fading')
        apply()
        window.setTimeout(() => root.classList.remove('theme-fading'), 300)
      } else {
        apply()
      }
      return
    }

    setBusy(true)
    const { top, left, width, height } = button.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const w = window.innerWidth // innerWidth: snapshot box incl. scrollbars
    const h = window.innerHeight
    const pct = radiusPct(x, y, w, h)
    const clip = [`circle(0% at ${x}px ${y}px)`, `circle(${pct}% at ${x}px ${y}px)`]

    const vt = document.startViewTransition(apply)
    vt.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: clip },
          {
            duration: WIPE_MS,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            fill: 'forwards',
            pseudoElement: '::view-transition-new(root)',
          },
        )
      })
      .catch(() => {})
    vt.finished.finally(() => setBusy(false)).catch(() => {})
  }, [busy])

  const dark = m === 'dark'
  /* Rail-aware tile styling: the Sidebar passes `dark` = the rail is WHITE
   * (dark mode) — blue marks, brand-blue focus ring. Default (midnight
   * rail): white marks, white focus ring. Literals, not theme tokens —
   * `text-blue` gets lifted to #4D94FF by the dark override, wrong on white. */
  const onWhiteRail = railIsWhite
  return (
    <button
      ref={btn}
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={
        onWhiteRail
          ? 'group flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-center transition-colors text-[#0052CC] hover:bg-[#0066FF]/[0.06] hover:text-[#0066FF] focus-visible:outline-[#0066FF] active:scale-[0.96]'
          : 'group flex w-16 flex-col items-center gap-1 rounded-[10px] px-1 py-2.5 text-center transition-colors text-white/60 hover:bg-white/5 hover:text-white focus-visible:outline-white active:scale-[0.96]'
      }
    >
      <span ref={iconWrap} className="theme-toggle-icon block h-5 w-5 text-current">
        {/* Sun core + rays; the moving mask circle turns it into a moon.
            stroke=currentColor keeps the icon legible on the midnight rail
            in BOTH modes (rail never flips). */}
        <svg width="20" height="20" viewBox="0 0 25 25" fill="none" aria-hidden="true">
          <defs>
            <mask id="neu-theme-mask">
              <rect x="0" y="0" width="25" height="25" fill="white" />
              <circle ref={maskRef} cx="20" cy="6" r="7" fill="black" />
            </mask>
          </defs>
          <g mask="url(#neu-theme-mask)">
            <circle ref={coreRef} cx="12.5" cy="12.5" r="6.9" fill="currentColor" />
          </g>
          <g
            ref={raysRef}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            style={{ transformOrigin: '12.5px 12.5px' }}
          >
            <line x1="12.5" y1="1.6" x2="12.5" y2="4.2" />
            <line x1="12.5" y1="20.8" x2="12.5" y2="23.4" />
            <line x1="1.6" y1="12.5" x2="4.2" y2="12.5" />
            <line x1="20.8" y1="12.5" x2="23.4" y2="12.5" />
            <line x1="4.8" y1="4.8" x2="6.6" y2="6.6" />
            <line x1="18.4" y1="18.4" x2="20.2" y2="20.2" />
            <line x1="4.8" y1="20.2" x2="6.6" y2="18.4" />
            <line x1="18.4" y1="6.6" x2="20.2" y2="4.8" />
          </g>
        </svg>
      </span>
      <span className="w-full text-[10px] font-medium leading-tight truncate">
        {dark ? 'Light' : 'Dark'}
      </span>
    </button>
  )
}

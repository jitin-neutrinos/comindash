// GSAP is the app's single animation runtime (spec: task-frontend-revamp).
// Best practices applied: transform aliases, timelines over delay-chains,
// shared defaults, gsap.matchMedia() reduced-motion guards everywhere.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import gsap from 'gsap'
import { shadows } from './theme'

gsap.defaults({ duration: 0.6, ease: 'power3.out' })

export { gsap }

/* ---- reduced motion --------------------------------------------------------- */
const MQL =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

const subscribeMql = (cb) => {
  MQL?.addEventListener('change', cb)
  return () => MQL?.removeEventListener('change', cb)
}

/** Reactive prefers-reduced-motion (re-renders on change). */
export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeMql, () => MQL?.matches ?? false, () => false)
}

/** Imperative prefers-reduced-motion check (inside effects). */
export const prefersReducedMotion = () => MQL?.matches ?? false

/* ---- 1. page-load choreography ----------------------------------------------
 * Pages tag sections with data-anim="header" | "kpi" | "row" | "chart" and
 * attach the returned ref to their root. Runs once per mount (deps).
 */
export function usePageChoreo(deps = []) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline()
      const header = root.querySelectorAll('[data-anim="header"]')
      const kpis = root.querySelectorAll('[data-anim="kpi"]')
      const rows = root.querySelectorAll('[data-anim="row"]')
      const charts = root.querySelectorAll('[data-anim="chart"]')
      if (header.length) {
        tl.fromTo(header, { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.45 })
      }
      if (kpis.length) {
        tl.fromTo(
          kpis,
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, stagger: 0.08 },
          header.length ? '-=0.3' : 0,
        )
      }
      if (rows.length) {
        tl.fromTo(
          rows,
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, stagger: 0.06, duration: 0.5 },
          kpis.length ? '-=0.35' : 0.1,
        )
      }
      if (charts.length) {
        tl.fromTo(
          charts,
          { autoAlpha: 0, scale: 0.98, transformOrigin: '50% 50%' },
          { autoAlpha: 1, scale: 1, duration: 0.5 },
          kpis.length || rows.length ? '-=0.25' : 0.15,
        )
      }
      return () => tl.kill()
    })
    return () => mm.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

/* ---- 3. route transitions ----------------------------------------------------
 * Outgoing view fades out (0.2s), then the new location mounts and each page
 * runs its own load timeline. Returns the location to render.
 */
export function useGsapPageTransition() {
  const location = useLocation()
  const [view, setView] = useState(location)
  const pending = useRef(location)
  const tween = useRef(null)

  useEffect(() => {
    pending.current = location
    if (location.pathname === view.pathname) return undefined
    const el = document.getElementById('page-view')
    const commit = () => {
      window.scrollTo(0, 0)
      setView(pending.current)
    }
    tween.current?.kill()
    if (el && !prefersReducedMotion()) {
      tween.current = gsap.to(el, {
        autoAlpha: 0,
        duration: 0.2,
        ease: 'power2.in',
        onComplete: commit,
      })
    } else {
      commit()
    }
    return () => tween.current?.kill()
  }, [location, view])

  return view
}

/* ---- 2. count-up numbers ------------------------------------------------------
 * Tweens an object and writes textContent — runs on mount and on every value
 * change (from the previous value). snap:1 for integer metrics only.
 * Reduced motion / non-numeric values render the final value immediately.
 */
export function useCountUp(ref, value, format, { duration = 0.9 } = {}) {
  const prev = useRef(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const fmt = format ?? ((v) => Math.round(v).toLocaleString())
    const from = prev.current
    prev.current = value
    if (prefersReducedMotion()) {
      el.textContent = fmt(value)
      return undefined
    }
    const state = { v: from }
    el.textContent = fmt(from)
    const tween = gsap.to(state, {
      v: value,
      duration,
      ease: 'power2.out',
      snap: format ? undefined : { v: 1 },
      onUpdate: () => {
        el.textContent = fmt(state.v)
      },
    })
    return () => tween.kill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ref])
}

/* ---- 4. micro-interactions (global, event-delegated) -------------------------
 * Card hover lift (y:-4 + shadow), button/link press scale 0.97.
 * Disabled entirely under reduced motion.
 */
export function useMicroInteractions() {
  useEffect(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const press = (e) => {
        const t = e.target.closest?.('button, [role="tab"], a[href]')
        if (t) gsap.to(t, { scale: 0.97, duration: 0.12, ease: 'power2.out', overwrite: 'auto' })
      }
      const release = (e) => {
        const t = e.target.closest?.('button, [role="tab"], a[href]')
        if (t) gsap.to(t, { scale: 1, duration: 0.25, ease: 'power2.out', overwrite: 'auto' })
      }
      const lift = (e) => {
        const c = e.target.closest?.('.card-lift')
        if (c) gsap.to(c, { y: -4, boxShadow: shadows.lift, duration: 0.25, ease: 'power2.out', overwrite: 'auto' })
      }
      const drop = (e) => {
        const c = e.target.closest?.('.card-lift')
        if (c) gsap.to(c, { y: 0, boxShadow: shadows.rest, duration: 0.25, ease: 'power2.out', overwrite: 'auto' })
      }
      document.addEventListener('pointerdown', press)
      document.addEventListener('pointerup', release)
      document.addEventListener('pointercancel', release)
      document.addEventListener('pointerover', lift)
      document.addEventListener('pointerout', drop)
      return () => {
        document.removeEventListener('pointerdown', press)
        document.removeEventListener('pointerup', release)
        document.removeEventListener('pointercancel', release)
        document.removeEventListener('pointerover', lift)
        document.removeEventListener('pointerout', drop)
      }
    })
    return () => mm.revert()
  }, [])
}

/* ---- 6. attention pulse --------------------------------------------------------
 * Subtle yoyo pulse on status dots. `active` gates it (pause when healthy).
 */
export function usePulse(ref, active) {
  useEffect(() => {
    const el = ref.current
    if (!el || !active || prefersReducedMotion()) return undefined
    const tween = gsap.to(el, {
      scale: 1.35,
      autoAlpha: 0.55,
      duration: 0.9,
      ease: 'power1.inOut',
      repeat: -1,
      yoyo: true,
    })
    return () => {
      tween.kill()
      gsap.set(el, { clearProps: 'scale,opacity,visibility' })
    }
  }, [ref, active])
}

/** Pulse every element matching `selector` under `rootRef` (re-run on deps). */
export function usePulseAll(rootRef, selector, deps = []) {
  useEffect(() => {
    const els = rootRef.current?.querySelectorAll(selector)
    if (!els?.length || prefersReducedMotion()) return undefined
    const tweens = [...els].map((el) =>
      gsap.to(el, {
        scale: 1.35,
        autoAlpha: 0.55,
        duration: 0.9,
        ease: 'power1.inOut',
        repeat: -1,
        yoyo: true,
      }),
    )
    return () => {
      tweens.forEach((t) => t.kill())
      els.forEach((el) => gsap.set(el, { clearProps: 'scale,opacity,visibility' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

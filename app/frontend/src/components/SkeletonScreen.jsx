import { useEffect, useRef, useState } from 'react'

/**
 * Animated skeleton screens for the login mockups.
 *
 * Six variants (overview, metrics, insights, relationships, explorer, admin),
 * each a shimmering wireframe that mimics that page's real layout, at two form
 * factors (laptop and phone). A GSAP cross-fade rotates through them so the
 * device shows a living product rather than a static screenshot.
 *
 * Smoothness: the swap is a true cross-fade — the outgoing variant fades out
 * while the incoming one fades in, both with the same long ease, so there is no
 * blank frame or blur snap between them. Only opacity/transform are animated.
 * prefers-reduced-motion holds the first variant still.
 */

export const PAGES = ['overview', 'metrics', 'insights', 'relationships', 'explorer', 'admin']
const ROTATE_MS = 3600
const FADE_S = 0.75

function Line({ w = '100%', h = 7, dim = 0.5, r = 3 }) {
  return <div className="sk-line" style={{ width: w, height: h, borderRadius: r, opacity: dim }} />
}
function Block({ w = '100%', h = 40, r = 8, dim = 0.35, children, className = '' }) {
  return (
    <div className={`sk-block ${className}`} style={{ width: w, height: h, borderRadius: r, opacity: dim }}>
      {children}
    </div>
  )
}

/* ---------- laptop layouts ---------- */
function OverviewL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Line w="34%" h={9} dim={0.7} />
      <Line w="52%" h={5} dim={0.35} />
      <div className="mt-1 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Block key={i} h={34}>
            <div className="flex h-full flex-col justify-between p-2">
              <Line w="55%" h={4} dim={0.35} />
              <Line w="40%" h={10} dim={0.6} />
              <Line w="70%" h={3} dim={0.25} />
            </div>
          </Block>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-2">
        {[0, 1].map((i) => (
          <Block key={i} h="100%">
            <div className="flex h-full flex-col gap-1.5 p-2">
              <Line w="45%" h={5} dim={0.5} />
              <Line w="90%" h={4} dim={0.28} />
              <Line w="80%" h={4} dim={0.28} />
              <Line w="86%" h={4} dim={0.28} />
            </div>
          </Block>
        ))}
      </div>
    </div>
  )
}
function MetricsL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <Line w="26%" h={9} dim={0.7} />
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => <Block key={i} w={34} h={10} r={5} dim={0.3} />)}
        </div>
      </div>
      <Block h="52%">
        <div className="flex h-full items-end gap-1.5 p-3">
          {[35, 60, 42, 78, 55, 88, 48, 66, 30, 72].map((h, i) => (
            <div key={i} className="sk-bar" style={{ height: `${h}%`, width: '7%', borderRadius: 3 }} />
          ))}
        </div>
      </Block>
      <div className="grid flex-1 grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="100%">
            <div className="flex h-full flex-col justify-center gap-1.5 p-2">
              <Line w="60%" h={6} dim={0.55} />
              <Line w="80%" h={3} dim={0.25} />
            </div>
          </Block>
        ))}
      </div>
    </div>
  )
}
function InsightsL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Line w="30%" h={9} dim={0.7} />
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => <Block key={i} w={46} h={9} r={5} dim={0.3} />)}
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="100%" className="flex-1">
            <div className="flex h-full items-center gap-3 p-2.5">
              <div className="sk-dot" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Line w={`${70 - i * 8}%`} h={5} dim={0.5} />
                <Line w={`${45 - i * 5}%`} h={3} dim={0.25} />
              </div>
              <Line w={40} h={5} dim={0.3} />
            </div>
          </Block>
        ))}
      </div>
    </div>
  )
}
function RelationshipsL() {
  return (
    <div className="flex h-full gap-2 p-3">
      <div className="flex flex-1 flex-col gap-2">
        <Line w="40%" h={9} dim={0.7} />
        <Block h="100%" className="relative flex-1">
          <svg viewBox="0 0 200 120" className="h-full w-full opacity-70">
            <g stroke="currentColor" strokeWidth="1" className="text-white/30">
              <line x1="60" y1="40" x2="120" y2="30" /><line x1="60" y1="40" x2="100" y2="80" />
              <line x1="120" y1="30" x2="160" y2="60" /><line x1="100" y1="80" x2="160" y2="60" />
              <line x1="100" y1="80" x2="60" y2="95" /><line x1="120" y1="30" x2="100" y2="80" />
            </g>
            <g fill="currentColor" className="text-white/60">
              <circle cx="60" cy="40" r="9" /><circle cx="120" cy="30" r="7" />
              <circle cx="100" cy="80" r="11" /><circle cx="160" cy="60" r="6" />
              <circle cx="60" cy="95" r="5" />
            </g>
          </svg>
        </Block>
      </div>
      <div className="flex w-1/4 flex-col gap-2">
        <Block h="30%"><div className="p-2"><Line w="70%" h={5} dim={0.5} /></div></Block>
        <Block h="100%" className="flex-1">
          <div className="flex h-full flex-col gap-1.5 p-2">
            {[0, 1, 2, 3, 4].map((i) => <Line key={i} w={`${80 - i * 7}%`} h={4} dim={0.28} />)}
          </div>
        </Block>
      </div>
    </div>
  )
}
function ExplorerL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <Line w="24%" h={9} dim={0.7} />
        <Block w={90} h={12} r={6} dim={0.3} />
      </div>
      <div className="sk-table flex flex-1 flex-col">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-3 border-b border-white/5 px-1">
            <Line w="22%" h={4} dim={0.4} />
            <Line w="30%" h={4} dim={0.28} />
            <Line w="14%" h={4} dim={0.28} />
            <Line w="10%" h={4} dim={0.28} />
          </div>
        ))}
      </div>
    </div>
  )
}
function AdminL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Line w="22%" h={9} dim={0.7} />
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h={30}>
            <div className="flex h-full flex-col justify-center gap-1.5 p-2">
              <Line w="50%" h={5} dim={0.5} />
              <Line w="75%" h={3} dim={0.25} />
            </div>
          </Block>
        ))}
      </div>
      <Block h="100%" className="flex-1">
        <div className="flex h-full flex-col gap-1.5 p-2.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="sk-dot" style={{ opacity: 0.35 + (i % 3) * 0.15 }} />
              <Line w={`${72 - i * 6}%`} h={4} dim={0.26} />
            </div>
          ))}
        </div>
      </Block>
    </div>
  )
}

/* ---------- phone layouts ---------- */
function PhoneShell({ children }) {
  return (
    <div className="flex h-full flex-col bg-[#fbfbfd]">
      <div className="sk-phone-header flex shrink-0 items-center justify-between px-3 pb-2 pt-3">
        <div className="sk-dot" style={{ opacity: 0.6 }} />
        <Line w="34%" h={4} dim={0.4} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3 pt-2">{children}</div>
    </div>
  )
}
function OverviewP() {
  return (
    <PhoneShell>
      <Line w="46%" h={8} dim={0.65} />
      <Line w="70%" h={4} dim={0.3} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h={46}>
            <div className="flex h-full flex-col justify-between p-2">
              <Line w="60%" h={4} dim={0.3} />
              <Line w="45%" h={10} dim={0.6} />
            </div>
          </Block>
        ))}
      </div>
      <Block h="100%" className="mt-2 flex-1">
        <div className="flex h-full flex-col gap-1.5 p-2">
          <Line w="55%" h={5} dim={0.45} />
          <Line w="88%" h={4} dim={0.26} />
          <Line w="80%" h={4} dim={0.26} />
        </div>
      </Block>
    </PhoneShell>
  )
}
function MetricsP() {
  return (
    <PhoneShell>
      <Line w="40%" h={8} dim={0.65} />
      <div className="mt-2 flex gap-1.5">
        {[0, 1, 2].map((i) => <Block key={i} w={40} h={9} r={5} dim={0.3} />)}
      </div>
      <Block h="40%" className="mt-2">
        <div className="flex h-full items-end gap-1 p-2.5">
          {[40, 65, 45, 80, 55, 90, 50].map((h, i) => (
            <div key={i} className="sk-bar" style={{ height: `${h}%`, width: '10%', borderRadius: 3 }} />
          ))}
        </div>
      </Block>
      <div className="mt-2 grid flex-1 grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="100%">
            <div className="flex h-full flex-col justify-center gap-1.5 p-2">
              <Line w="55%" h={5} dim={0.5} />
              <Line w="75%" h={3} dim={0.24} />
            </div>
          </Block>
        ))}
      </div>
    </PhoneShell>
  )
}
function InsightsP() {
  return (
    <PhoneShell>
      <Line w="40%" h={8} dim={0.65} />
      <div className="mt-2 flex gap-1.5">
        {[0, 1].map((i) => <Block key={i} w={52} h={9} r={5} dim={0.3} />)}
      </div>
      <div className="mt-2 flex flex-1 flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h="100%" className="flex-1">
            <div className="flex h-full items-center gap-2 p-2">
              <div className="sk-dot" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Line w={`${72 - i * 9}%`} h={4} dim={0.45} />
                <Line w={`${50 - i * 6}%`} h={3} dim={0.24} />
              </div>
            </div>
          </Block>
        ))}
      </div>
    </PhoneShell>
  )
}
function RelationshipsP() {
  return (
    <PhoneShell>
      <Line w="52%" h={8} dim={0.65} />
      <Block h="55%" className="mt-2">
        <svg viewBox="0 0 160 120" className="h-full w-full opacity-70">
          <g stroke="currentColor" strokeWidth="1" className="text-white/30">
            <line x1="50" y1="35" x2="105" y2="28" /><line x1="50" y1="35" x2="80" y2="75" />
            <line x1="105" y1="28" x2="125" y2="70" /><line x1="80" y1="75" x2="125" y2="70" />
          </g>
          <g fill="currentColor" className="text-white/60">
            <circle cx="50" cy="35" r="10" /><circle cx="105" cy="28" r="7" />
            <circle cx="80" cy="75" r="12" /><circle cx="125" cy="70" r="6" />
          </g>
        </svg>
      </Block>
      <Block h="100%" className="mt-2 flex-1">
        <div className="flex h-full flex-col gap-1.5 p-2">
          {[0, 1, 2, 3].map((i) => <Line key={i} w={`${82 - i * 8}%`} h={4} dim={0.26} />)}
        </div>
      </Block>
    </PhoneShell>
  )
}
function ExplorerP() {
  return (
    <PhoneShell>
      <Line w="42%" h={8} dim={0.65} />
      <div className="mt-2 flex flex-1 flex-col">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-2 border-b border-white/5">
            <Line w="34%" h={4} dim={0.4} />
            <Line w="40%" h={4} dim={0.26} />
          </div>
        ))}
      </div>
    </PhoneShell>
  )
}
function AdminP() {
  return (
    <PhoneShell>
      <Line w="34%" h={8} dim={0.65} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h={40}>
            <div className="flex h-full flex-col justify-center gap-1.5 p-2">
              <Line w="55%" h={5} dim={0.5} />
              <Line w="78%" h={3} dim={0.24} />
            </div>
          </Block>
        ))}
      </div>
      <Block h="100%" className="mt-2 flex-1">
        <div className="flex h-full flex-col gap-1.5 p-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="sk-dot" style={{ opacity: 0.35 + (i % 3) * 0.15 }} />
              <Line w={`${70 - i * 7}%`} h={4} dim={0.26} />
            </div>
          ))}
        </div>
      </Block>
    </PhoneShell>
  )
}

const LAPTOP = {
  overview: OverviewL, metrics: MetricsL, insights: InsightsL,
  relationships: RelationshipsL, explorer: ExplorerL, admin: AdminL,
}
const PHONE = {
  overview: OverviewP, metrics: MetricsP, insights: InsightsP,
  relationships: RelationshipsP, explorer: ExplorerP, admin: AdminP,
}

export function SkeletonScreen({ form = 'laptop', page = 'overview' }) {
  const Comp = (form === 'phone' ? PHONE : LAPTOP)[page] || OverviewL
  return <Comp />
}

/**
 * GSAP cross-fade rotation. Keeps the outgoing variant mounted and fades it out
 * while the incoming one fades in, so the two overlap and there is never a
 * blank frame or a blur snap.
 */
export function useSkeletonRotation(intervalMs = ROTATE_MS) {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState(null)
  const hostRef = useRef(null)
  const gsapRef = useRef(null)

  // load gsap once
  useEffect(() => {
    let cancelled = false
    import('gsap').then(({ default: gsap }) => {
      if (!cancelled) gsapRef.current = gsap
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const id = setInterval(() => {
      setLeaving(index)
      setIndex((i) => (i + 1) % PAGES.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [index, intervalMs])

  // animate the incoming panel in and the outgoing one out, in parallel
  useEffect(() => {
    const gsap = gsapRef.current
    const host = hostRef.current
    if (!gsap || !host) return
    const panels = host.querySelectorAll('[data-sk-panel]')
    if (!panels.length) return
    const tween = gsap.to(panels, {
      opacity: 1,
      duration: FADE_S,
      ease: 'power2.inOut',
      stagger: 0,
      overwrite: 'auto',
    })
    return () => tween.kill()
  }, [index, leaving])

  return { page: PAGES[index], leavingPage: leaving == null ? null : PAGES[leaving], ref: hostRef }
}

/** Renders the current + leaving variant stacked, cross-fading between them. */
export function SkeletonStage({ form, page, leavingPage, hostRef }) {
  return (
    <div ref={hostRef} className="relative h-full w-full">
      {leavingPage && (
        <div
          key={`out-${leavingPage}`}
          data-sk-panel
          className="absolute inset-0"
          style={{ opacity: 0 }}
        >
          <SkeletonScreen form={form} page={leavingPage} />
        </div>
      )}
      <div
        key={`in-${page}`}
        data-sk-panel
        className="absolute inset-0"
        style={{ opacity: leavingPage ? 0 : 1 }}
      >
        <SkeletonScreen form={form} page={page} />
      </div>
    </div>
  )
}

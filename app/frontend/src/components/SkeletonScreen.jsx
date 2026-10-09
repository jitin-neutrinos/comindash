import { useEffect, useRef, useState } from 'react'
import neuSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'

/**
 * Animated skeleton screens for the login mockups.
 *
 * Six page variants (overview, metrics, insights, relationships, explorer,
 * admin) rendered inside real device chrome:
 *   - laptop: a macOS desktop — menu bar (traffic lights, app name, status
 *     icons) over an app window with the dark Neutrinos sidebar rail.
 *   - phone: iOS — status bar at the top, tab bar at the bottom, brand header.
 *
 * A GSAP cross-fade rotates through the variants (outgoing fades out while the
 * incoming fades in — no blank frame, no blur snap). Only opacity/transform are
 * animated. prefers-reduced-motion holds the first variant still.
 */

export const PAGES = ['overview', 'metrics', 'insights', 'relationships', 'explorer', 'admin']
const ROTATE_MS = 3600
const FADE_S = 0.75

function Line({ w = '100%', h = 7, dim = 0.5, r = 3, className = '' }) {
  return <div className={`sk-line ${className}`} style={{ width: w, height: h, borderRadius: r, opacity: dim }} />
}
function Block({ w = '100%', h = 40, r = 8, dim = 0.35, children, className = '' }) {
  return (
    <div className={`sk-block ${className}`} style={{ width: w, height: h, borderRadius: r, opacity: dim }}>
      {children}
    </div>
  )
}

/* ---------- Neutrinos symbol (the real brand mark) ---------- */
function NeuMark({ size = 16 }) {
  return (
    <img
      src={neuSymbolWhite}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="shrink-0 object-contain"
    />
  )
}

/* ---------- macOS laptop chrome ---------- */
const NAV = ['Overview', 'Metrics', 'Insights', 'Relations', 'Explorer', 'Admin']

function MacWindow({ children }) {
  return (
    <div className="flex h-full flex-col bg-[#1c1c1e]">
      {/* macOS menu bar: Apple menu, app menus, status area */}
      <div className="flex shrink-0 items-center justify-between bg-[#2a2a2d]/95 px-2.5 py-[5px]">
        <div className="flex items-center gap-2.5">
          <svg width="9" height="11" viewBox="0 0 24 28" fill="#fff" aria-hidden="true">
            <path d="M18.7 14.8c0-3 2.5-4.4 2.6-4.5-1.4-2.1-3.6-2.4-4.4-2.4-1.9-.2-3.6 1.1-4.6 1.1s-2.4-1.1-4-1.1c-2 0-3.9 1.2-5 3-2.1 3.7-.5 9.1 1.5 12.1 1 1.5 2.2 3.1 3.8 3 1.5-.1 2.1-1 3.9-1s2.4 1 4 1 2.7-1.5 3.7-2.9c1.2-1.7 1.6-3.3 1.7-3.4-.1 0-3.2-1.2-3.2-4.9zM15.6 6.3c.8-1 1.4-2.4 1.3-3.8-1.2.1-2.7.8-3.6 1.8-.8.9-1.4 2.3-1.2 3.7 1.4.1 2.7-.7 3.5-1.7z" />
          </svg>
          <span className="flex items-center gap-1.5">
            <NeuMark size={11} />
            <span className="text-[8px] font-semibold text-white/90">Community Insights</span>
          </span>
          <span className="flex items-center gap-2.5 text-[8px] text-white/70">
            <span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-white/60">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <svg width="10" height="9" viewBox="0 0 24 20" fill="currentColor"><path d="M12 18l3-4a5 5 0 0 0-6 0l3 4Z" /><path d="M5 11a11 11 0 0 1 14 0l-2 2.4a8 8 0 0 0-10 0L5 11Z" opacity=".7" /></svg>
          <svg width="12" height="9" viewBox="0 0 26 12" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="21" height="11" rx="3" /><rect x="2" y="2" width="15" height="8" rx="1.5" fill="currentColor" /><rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" /></svg>
          <span className="text-[8px] tabular-nums text-white/70">Mon 9:41</span>
        </div>
      </div>
      {/* app window: sidebar rail + content */}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[16%] shrink-0 flex-col items-center gap-2 bg-[#00053d] py-2.5">
          <NeuMark size={15} />
          <div className="mt-1 flex w-full flex-col items-center gap-2.5">
            {NAV.map((n, i) => (
              <div key={n} className={`sk-nav ${i === 0 ? 'sk-nav--on' : ''}`} />
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {/* window title bar with traffic lights */}
          <div className="flex shrink-0 items-center gap-1.5 border-b border-black/5 bg-[#ececec] px-2.5 py-[4px]">
            <i className="sk-tl" style={{ background: '#ff5f57' }} />
            <i className="sk-tl" style={{ background: '#febc2e' }} />
            <i className="sk-tl" style={{ background: '#28c840' }} />
            <span className="mx-auto text-[7px] font-medium text-black/55">Community Insights — Overview</span>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

/* ---------- laptop page bodies ---------- */
function OverviewL() {
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <Line w="34%" h={9} dim={0.7} />
      <Line w="52%" h={5} dim={0.35} />
      <div className="mt-1 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Block key={i} h={32}>
            <div className="flex h-full flex-col justify-between p-2">
              <Line w="55%" h={4} dim={0.35} />
              <Line w="40%" h={9} dim={0.6} />
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
          {[0, 1, 2].map((i) => <Block key={i} w={32} h={10} r={5} dim={0.3} />)}
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
        {[0, 1, 2, 3].map((i) => <Block key={i} w={44} h={9} r={5} dim={0.3} />)}
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
              <Line w={38} h={5} dim={0.3} />
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
        <Block w={86} h={12} r={6} dim={0.3} />
      </div>
      <div className="flex flex-1 flex-col">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-3 border-b border-black/5 px-1">
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
          <Block key={i} h={28}>
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

/* ---------- iOS phone chrome ---------- */
function PhoneShell({ children }) {
  return (
    <div className="flex h-full flex-col bg-[#f2f2f7]">
      {/* status bar */}
      <div className="relative flex shrink-0 items-center justify-between bg-white px-3.5 pb-1.5 pt-2 text-[8px] font-semibold text-black">
        <span className="tabular-nums">9:41</span>
        <span className="flex items-center gap-1">
          <svg width="11" height="7" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
          <svg width="13" height="7" viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="18" height="11" rx="3" /><rect x="2" y="2" width="13" height="8" rx="1.5" fill="currentColor" /><rect x="20" y="4" width="2" height="4" rx="1" fill="currentColor" /></svg>
        </span>
      </div>
      {/* brand header — taller so the mark and label are not cramped */}
      <div className="flex shrink-0 items-center gap-2 bg-[#00053d] px-3 py-2.5">
        <NeuMark size={14} />
        <span className="text-[9px] font-medium tracking-tight text-white">Community Insights</span>
      </div>
      {/* content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">{children}</div>
      {/* bottom tab bar */}
      <div className="flex shrink-0 items-center justify-around border-t border-black/10 bg-white px-2 pt-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`sk-tab ${i === 0 ? 'sk-tab--on' : ''}`} />
        ))}
      </div>
      {/* home indicator */}
      <div className="flex shrink-0 justify-center bg-white pb-1.5 pt-1">
        <span className="h-[3px] w-[30%] rounded-full bg-black/25" />
      </div>
    </div>
  )
}

/* ---------- phone page bodies ---------- */
function OverviewP() {
  return (
    <>
      <Line w="46%" h={8} dim={0.65} />
      <Line w="70%" h={4} dim={0.3} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h={44}>
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
    </>
  )
}
function MetricsP() {
  return (
    <>
      <Line w="40%" h={8} dim={0.65} />
      <div className="mt-2 flex gap-1.5">
        {[0, 1, 2].map((i) => <Block key={i} w={38} h={9} r={5} dim={0.3} />)}
      </div>
      <Block h="38%" className="mt-2">
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
    </>
  )
}
function InsightsP() {
  return (
    <>
      <Line w="40%" h={8} dim={0.65} />
      <div className="mt-2 flex gap-1.5">
        {[0, 1].map((i) => <Block key={i} w={50} h={9} r={5} dim={0.3} />)}
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
    </>
  )
}
function RelationshipsP() {
  return (
    <>
      <Line w="52%" h={8} dim={0.65} />
      <Block h="50%" className="mt-2">
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
    </>
  )
}
function ExplorerP() {
  return (
    <>
      <Line w="42%" h={8} dim={0.65} />
      <div className="mt-2 flex flex-1 flex-col">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-1 items-center gap-2 border-b border-black/5">
            <Line w="34%" h={4} dim={0.4} />
            <Line w="40%" h={4} dim={0.26} />
          </div>
        ))}
      </div>
    </>
  )
}
function AdminP() {
  return (
    <>
      <Line w="34%" h={8} dim={0.65} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Block key={i} h={38}>
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
    </>
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
  if (form === 'phone') {
    const Comp = PHONE[page] || OverviewP
    return (
      <PhoneShell>
        <Comp />
      </PhoneShell>
    )
  }
  const Comp = LAPTOP[page] || OverviewL
  return (
    <MacWindow>
      <Comp />
    </MacWindow>
  )
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
      overwrite: 'auto',
    })
    return () => tween.kill()
  }, [index, leaving])

  return { page: PAGES[index], leavingPage: leaving == null ? null : PAGES[leaving], ref: hostRef }
}

export function SkeletonStage({ form, page, leavingPage, hostRef }) {
  return (
    <div ref={hostRef} className="relative h-full w-full">
      {leavingPage && (
        <div key={`out-${leavingPage}`} data-sk-panel className="absolute inset-0" style={{ opacity: 0 }}>
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

import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useState } from 'react'
import Sidebar from './components/Sidebar'
import { NAV } from './components/Header' 
import StaleBanner from './components/StaleBanner'
import Overview from './pages/Overview'
import MetricsExplorer from './pages/MetricsExplorer'
import PainPoints from './pages/PainPoints'
import Relationships from './pages/Relationships'
import DataExplorer from './pages/DataExplorer'
import InsightDetail from './pages/InsightDetail'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import { useGsapPageTransition, useMicroInteractions } from './motion'

function sectionLabel(pathname) {
  const hit = NAV.find((n) => n.to === pathname)
  if (hit) return hit.label
  if (pathname.startsWith('/insights')) return 'Insight detail'
  return 'Overview'
}

function Shell() {
  const view = useGsapPageTransition()
  const [navOpen, setNavOpen] = useState(false)
  useMicroInteractions()

  return (
    <div className="min-h-screen bg-mist font-sans font-light text-black">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-pill focus:bg-white focus:px-4 focus:py-2 focus:text-small focus:font-medium focus:text-blue"
      >
        Skip to content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      {/* Content sits inside the lg:pl-20 wrapper so it starts right of the
          fixed 80px icon rail — zero overlap, no layout shift on route change. */}
      <div id="content-shell" className="flex min-h-screen flex-col lg:pl-20">
        {/* Mobile-only nav toggle bar (desktop has no header at all) */}
        <div className="sticky top-0 z-40 flex h-12 items-center bg-midnight px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle navigation"
            className="rounded-pill p-2 text-white transition-colors hover:bg-white/10"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <StaleBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {/* Keyed wrapper: fresh node per route so pages run their own GSAP load timeline */}
          <div id="page-view" key={view.pathname}>
            <Routes location={view}>
              <Route path="/" element={<Overview />} />
              <Route path="/metrics" element={<MetricsExplorer />} />
              <Route path="/pain-points" element={<PainPoints />} />
              <Route path="/relationships" element={<Relationships />} />
              <Route path="/explorer" element={<DataExplorer />} />
              <Route path="/insights/:id" element={<InsightDetail />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Overview />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}

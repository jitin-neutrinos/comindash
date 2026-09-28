import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { useState } from 'react'
import Sidebar from './components/Sidebar'
import { NAV, default as Header } from './components/Header'
import StaleBanner from './components/StaleBanner'
import Overview from './pages/Overview'
import MetricsExplorer from './pages/MetricsExplorer'
import Insights from './pages/Insights'
import Relationships from './pages/Relationships'
import DataExplorer from './pages/DataExplorer'
import InsightDetail from './pages/InsightDetail'
import Admin from './pages/Admin'
import Review from './pages/Review'
import Settings from './pages/Settings'
import { useGsapPageTransition, useMicroInteractions } from './motion'
import { useMode } from './theme'

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
  // Theme: subscribing re-renders the tree on toggle so JS-inline color
  // consumers (charts, SVG fills via theme.js live bindings) repaint with
  // the new palette. CSS-variable consumers repaint via the .dark class.
  useMode()

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
        {/* Mobile-only nav toggle bar, theme-aware (desktop has no header) */}
        <Header section={sectionLabel(view.pathname)} onToggleNav={() => setNavOpen((v) => !v)} />
        <StaleBanner />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {/* Keyed wrapper: fresh node per route so pages run their own GSAP load timeline */}
          <div id="page-view" key={view.pathname}>
            <Routes location={view}>
              <Route path="/" element={<Overview />} />
              <Route path="/metrics" element={<MetricsExplorer />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/relationships" element={<Relationships />} />
              <Route path="/explorer" element={<DataExplorer />} />
              {/* `:ref` accepts both `/insights/30` and the canonical
                  `/insights/<slug>-30`; the page canonicalises the URL. */}
              <Route path="/insights/:ref" element={<InsightDetail />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/review" element={<Review />} />
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

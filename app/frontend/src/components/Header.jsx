import { useMode } from '../theme'

export const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/metrics', label: 'Metrics' },
  { to: '/insights', label: 'Insights' },
  { to: '/relationships', label: 'Relationships' },
  { to: '/explorer', label: 'Explorer' },
  { to: '/admin', label: 'Admin' },
]

/**
 * Mobile-only sticky top bar (desktop has no header — the sidebar carries
 * everything). Theme-aware, mirroring the Sidebar's rail treatment: light
 * mode = Midnight band with white marks; dark mode = white band with
 * Midnight marks and a Neutrinos-blue hover. Literals, not theme tokens —
 * dark-mode CSS overrides lift `text-blue` etc. and would be wrong on a
 * white surface (same note as ThemeToggle).
 */
export default function Header({ section, onToggleNav }) {
  const m = useMode()
  const dark = m === 'dark'
  return (
    <header
      className={`sticky top-0 z-40 lg:hidden ${dark ? 'border-b border-[#E6EAF0] bg-white text-[#00053D]' : 'bg-midnight text-white'}`}
    >
      <div className="flex h-12 items-center justify-between gap-4 px-3">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
          className={
            dark
              ? 'rounded-pill p-2 text-[#00053D] transition-colors hover:bg-[#0066FF]/[0.08] hover:text-[#0066FF]'
              : 'rounded-pill p-2 text-white transition-colors hover:bg-white/10'
          }
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <p
          className={`text-caption font-medium uppercase tracking-wider ${dark ? 'text-[#4A4A4A]' : 'text-white/60'}`}
        >
          {section}
        </p>
      </div>
    </header>
  )
}

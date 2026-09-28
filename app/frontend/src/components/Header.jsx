
export const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/metrics', label: 'Metrics' },
  { to: '/insights', label: 'Insights' },
  { to: '/relationships', label: 'Relationships' },
  { to: '/explorer', label: 'Explorer' },
  { to: '/admin', label: 'Admin' },
]

/** Sticky Midnight Blue header band: mobile nav toggle + logo + section label. */
export default function Header({ section, onToggleNav }) {
  return (
    <header className="sticky top-0 z-40 bg-midnight text-white">
      <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:pl-7 lg:pr-10">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleNav}
            aria-label="Toggle navigation"
            className="rounded-pill p-2 text-white transition-colors hover:bg-white/10 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="text-caption font-medium uppercase tracking-wider text-white/60">{section}</p>
      </div>
    </header>
  )
}

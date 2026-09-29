import { useMode } from '../theme'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'

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
 * everything). Height matches the Sidebar's logo container (50px symbol +
 * pt-4/pb-4 = 82px) so the mark sits at the same offset on both. The
 * hamburger is replaced by the Neutrinos symbol at the sidebar's size;
 * tapping it opens the drawer.
 *
 * Surface: SOLID Midnight Blue in BOTH modes (2026-09-29: user locked the
 * mobile header to the same color as the rail — the old translucent
 * white/70 dark-mode bar is retired). One style serves both modes, so no
 * mode branch is needed here anymore.
 */
export default function Header({ section, onToggleNav }) {
  return (
    <header className="sticky top-0 z-40 bg-midnight text-white lg:hidden">
      <div className="flex h-[82px] items-center justify-between gap-4 px-2">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
          className="rounded-pill p-2 transition-colors hover:bg-white/10"
        >
          <img
            src={logoSymbolWhite}
            alt="Neutrinos — open navigation"
            className="h-[50px] w-[50px]"
          />
        </button>
        <p className="mr-2 text-caption font-medium uppercase tracking-wider text-white/60">
          {section}
        </p>
      </div>
    </header>
  )
}

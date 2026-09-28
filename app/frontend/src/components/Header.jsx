import { useMode } from '../theme'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'
import logoSymbolColor from '../brand/logo/neutrinos-symbol-color.png'

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
 * tapping it opens the drawer. Glassmorphic: translucent surface +
 * backdrop-blur so content scrolls through it. Theme-aware, mirroring the
 * Sidebar's rail treatment (colour symbol on the white dark-mode bar,
 * white symbol on midnight). Literals, not theme tokens — dark-mode CSS
 * overrides lift `text-blue` etc. and would be wrong on a white surface.
 */
export default function Header({ section, onToggleNav }) {
  const m = useMode()
  const dark = m === 'dark'
  return (
    <header
      className={`sticky top-0 z-40 lg:hidden ${
        dark
          ? 'border-b border-[#E6EAF0] bg-white/70 text-[#00053D] backdrop-blur-xl'
          : 'bg-midnight/70 text-white backdrop-blur-xl'
      }`}
    >
      <div className="flex h-[82px] items-center justify-between gap-4 px-2">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
          className={
            dark
              ? 'rounded-pill p-2 transition-colors hover:bg-[#0066FF]/[0.08]'
              : 'rounded-pill p-2 transition-colors hover:bg-white/10'
          }
        >
          <img
            src={dark ? logoSymbolColor : logoSymbolWhite}
            alt="Neutrinos — open navigation"
            className="h-[50px] w-[50px]"
          />
        </button>
        <p
          className={`mr-2 text-caption font-medium uppercase tracking-wider ${dark ? 'text-[#4A4A4A]' : 'text-white/60'}`}
        >
          {section}
        </p>
      </div>
    </header>
  )
}

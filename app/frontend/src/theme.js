// Single source of truth for the dashboard's visual language.
// Every color used anywhere in the app derives from src/brand/tokens.json
// (or rgba() derivations of those tokens) — no hex values outside this file.
import tokens from './brand/tokens.json'

const core = tokens.color.core
const accent = tokens.color.accent

export const colors = {
  white: core.white.hex,
  blue: core.neutrinosBlue.hex,
  mist: core.mistGray.hex,
  midnight: core.midnightBlue.hex,
  black: core.black.hex,
  celeste: accent.celesteBlue.hex,
  mint: accent.mintGreen.hex,
  salmon: accent.salmon.hex,
  iris: accent.iris.hex,
}

/** rgba() derivation of a brand hex — the only place alpha colors are computed. */
export const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Font stack from brand tokens (Poppins primary, Segoe UI fallback per brand guide)
export const fontStack =
  '"Poppins", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

// Semantic mappings (charts are the one brand-sanctioned place accents may mix)
// Severity = pain-point severity ONLY (Salmon marks high-severity pain).
// Priority is a neutral classification → Neutrinos Blue shade ramp, no Salmon.
export const semantics = {
  severity: { high: colors.salmon, medium: colors.blue, low: colors.mint },
  priority: { high: colors.midnight, medium: colors.blue, low: colors.celeste },
  status: { active: colors.blue, resolved: colors.mint, superseded: colors.iris },
  run: {
    done: colors.mint,
    running: colors.blue,
    failed: colors.salmon,
    skipped: colors.iris,
    pending: alpha(colors.midnight, 0.35),
  },
  sentiment: { pos: colors.mint, neu: alpha(colors.midnight, 0.4), neg: colors.salmon },
}

// Card chrome tokens (spec: task-frontend-revamp — premium BI surfaces)
export const lines = {
  card: '#E6EAF0', // 1px card border on white cards
  grid: '#EEF1F5', // hairline chart gridlines
}

// Chart palette — brand-first, accents allowed per brand chart exception
export const chart = {
  primary: colors.blue,
  series: [colors.blue, colors.celeste, colors.mint, colors.salmon, colors.iris],
  grid: lines.grid,
  axis: alpha(colors.midnight, 0.55),
}

// Elevation — flat at rest, soft shadow only on hover lift
export const shadows = {
  rest: `0 1px 2px ${alpha(colors.midnight, 0.05)}`,
  sm: `0 1px 2px ${alpha(colors.midnight, 0.06)}`,
  md: `0 8px 24px ${alpha(colors.midnight, 0.1)}`,
  lift: `0 12px 28px ${alpha(colors.midnight, 0.12)}`,
}

// Tailwind theme extension — maps brand tokens onto utility classes.
// Values mirror tokens.css (border/muted/shadows are the token file's semantic roles).
export const tailwindTheme = {
  colors: {
    white: colors.white,
    blue: colors.blue,
    mist: colors.mist,
    midnight: colors.midnight,
    black: colors.black,
    celeste: colors.celeste,
    mint: colors.mint,
    salmon: colors.salmon,
    iris: colors.iris,
    line: lines.card,
    hairline: lines.grid,
    muted: '#4A4A4A', // --neu-text-muted from tokens.css
  },
  fontFamily: { sans: [fontStack] },
  fontSize: {
    display: tokens.typography.scaleRem.display + 'rem',
    h1: tokens.typography.scaleRem.h1 + 'rem',
    h2: tokens.typography.scaleRem.h2 + 'rem',
    h3: tokens.typography.scaleRem.h3 + 'rem',
    h4: tokens.typography.scaleRem.h4 + 'rem',
    body: tokens.typography.scaleRem.body + 'rem',
    small: tokens.typography.scaleRem.small + 'rem',
    caption: tokens.typography.scaleRem.caption + 'rem',
  },
  borderRadius: {
    pill: '999px',
    sm: '4px',
    md: '8px',
    xl: '12px', // card radius (spec: consistent 12–16px)
    '2xl': '16px', // large surface radius
  },
  boxShadow: {
    sm: shadows.sm,
    md: shadows.md,
    lift: shadows.lift,
  },
}

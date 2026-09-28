// Momentum is the page's core idea: an insight is not just a conclusion, it
// is a conclusion that is currently getting worse, holding, or fading. Every
// place that shows a state — chip, filter, legend, panel — reads it from here
// so the word, the colour and the meaning can never drift apart.
import { colors, semantics, alpha } from '../../theme'

/**
 * @typedef {'surging'|'rising'|'steady'|'cooling'|'dormant'|'new'} MomentumState
 */

export const MOMENTUM = {
  surging: {
    label: 'Surging',
    color: colors.salmon,
    // Plain language, not jargon: what a reader should actually take away.
    meaning: 'Posting about this is climbing steeply against its own recent baseline.',
    glyph: '▲▲',
  },
  rising: {
    label: 'Rising',
    color: colors.salmon,
    meaning: 'Posting about this is climbing against its own recent baseline.',
    glyph: '▲',
  },
  new: {
    label: 'New',
    color: colors.iris,
    meaning: 'Activity has appeared with no earlier baseline to compare against.',
    glyph: '✦',
  },
  steady: {
    label: 'Steady',
    color: colors.blue,
    meaning: 'Posting is holding roughly level against its own recent baseline.',
    glyph: '—',
  },
  cooling: {
    label: 'Cooling',
    color: colors.celeste,
    meaning: 'Posting is slowing against its own recent baseline.',
    glyph: '▼',
  },
  dormant: {
    label: 'Dormant',
    color: alpha(colors.midnight, 0.45),
    meaning: 'No posts at all in the recent window. The conclusion may still hold.',
    glyph: '○',
  },
}

/** Ordered worst-first — the order the UI lists states in. */
export const MOMENTUM_ORDER = ['surging', 'rising', 'new', 'steady', 'cooling', 'dormant']

export const momentumOf = (state) => MOMENTUM[state] ?? MOMENTUM.dormant

/**
 * Human-readable delta. Returns '' when there is no baseline to compare
 * against — showing "+0%" there would assert a comparison we did not make.
 */
export function deltaLabel(deltaPct) {
  if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) return ''
  const pct = Math.round(deltaPct * 100)
  if (pct === 0) return 'level'
  return `${pct > 0 ? '+' : ''}${pct}%`
}

/**
 * How an insight's scope was derived, in words a reader can act on.
 * The backend never hides this: a scope built from one broad product is a
 * weaker measurement than one narrowed by the insight's own terms, and the
 * UI says so rather than presenting both with equal confidence.
 */
export const SCOPE_MODE = {
  focused: {
    label: 'Focused',
    note: "Narrowed to posts containing this insight's own key terms.",
  },
  narrowed: {
    label: 'Narrowed',
    note: 'Posts mentioning every subject this insight is about.',
  },
  single: {
    label: 'Single subject',
    note: 'All posts mentioning this insight’s one subject.',
  },
  broad: {
    label: 'Broad',
    note: 'Could not be narrowed further — treat the size as an upper bound.',
  },
  none: {
    label: 'Evidence only',
    note: 'No measurable subject found; scope is the cited evidence posts.',
  },
}

export const scopeModeOf = (mode) => SCOPE_MODE[mode] ?? SCOPE_MODE.none

export const CONFIDENCE = {
  high: colors.mint,
  medium: colors.blue,
  low: colors.salmon,
}

export const TYPE_LABEL = (t) => String(t ?? '').replace(/_/g, ' ')

export const typeColor = (t) => semantics.insightType[t] ?? colors.celeste

export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 }
export const MOMENTUM_RANK = {
  surging: 0,
  rising: 1,
  new: 2,
  steady: 3,
  cooling: 4,
  dormant: 5,
}

/** Compact integer formatting for dense chips (1.2k, not 1,234). */
export const compact = (n) => {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(v / 1000)}k`
}

export const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`

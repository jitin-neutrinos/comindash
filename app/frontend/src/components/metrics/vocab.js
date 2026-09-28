// Shared vocabulary for the Metrics page.
//
// The four metric tabs each answer a different question and each needs its own
// accent, framing sentence and "what counts as bad" direction. Keeping that in
// one module means the tab, the chart, the brief header and the anomaly copy
// can never disagree about what a metric means.
//
// Colours come only from the brand palette in theme.js — no invented tokens.
import { colors, semantics, alpha } from '../../theme'

export const METRICS = [
  {
    key: 'volume',
    label: 'Post volume',
    accent: colors.blue,
    question: 'Is engagement healthy, and did anything change?',
    unit: 'posts',
  },
  {
    key: 'sentiment',
    label: 'Sentiment',
    accent: colors.salmon,
    question: 'Is community mood deteriorating, and on what?',
    unit: 'labelled posts',
  },
  {
    key: 'priority',
    label: 'Priority mix',
    accent: colors.iris,
    question: 'Is the urgent share of the workload growing?',
    unit: 'labelled posts',
  },
  {
    key: 'entity',
    label: 'Entities',
    accent: colors.mint,
    question: 'What is gaining or losing attention?',
    unit: 'mentions',
  },
]

export const metricMeta = (key) => METRICS.find((m) => m.key === key) ?? METRICS[0]

/** Series key -> display name + colour, per metric. Order = stack order. */
export const SERIES_KEYS = {
  sentiment: [
    { key: 'neg', label: 'Negative', color: semantics.sentiment.neg, bad: true },
    { key: 'neu', label: 'Neutral', color: semantics.sentiment.neu },
    { key: 'pos', label: 'Positive', color: semantics.sentiment.pos },
  ],
  priority: [
    { key: 'high', label: 'High', color: semantics.severity.high, bad: true },
    { key: 'medium', label: 'Medium', color: semantics.severity.medium },
    { key: 'low', label: 'Low', color: semantics.severity.low },
  ],
}

/** The key whose RISE is bad news — what the drift callout leads with. */
export const WATCH_KEY = { sentiment: 'neg', priority: 'high' }

export const CONFIDENCE_COLOR = {
  high: colors.mint,
  medium: colors.blue,
  low: colors.salmon,
}

export const pct = (v, digits = 0) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? '—'
    : `${(Number(v) * 100).toFixed(digits)}%`

/** Signed percentage for deltas — the sign is the whole point, so keep it. */
export const signedPct = (v, digits = 0) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v) * 100
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

export const shortDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const tint = (color, a) => alpha(color, a)

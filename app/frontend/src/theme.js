// Single source of truth for the dashboard's visual language.
// Every color used anywhere in the app derives from src/brand/tokens.json
// (or rgba() derivations of those tokens) — no hex values outside this file.
//
// DARK MODE (2026-09-28): `colors`, `lines`, `chart`, `shadows`, `semantics`
// and `graph` are LIVE bindings — setMode() reassigns them and every module
// that reads them at render time sees the new values after the rerender that
// setMode triggers (App subscribes via useMode()). Module-level constants
// that capture color STRINGS must read through functions instead (see
// chartKit.axisProps(), KnowledgeGraph.kindStyle(), InsightPanel.confidence()).
//
// Dark palette policy: Neutrinos Blue + brand neutrals ONLY, extended into
// dark-mode tints/shades of the same navy family (hue ≈ 225-232°, same as
// Midnight Blue #00053D). No new hues. The ramp inverts in dark so
// "alert/strong" reads brightest on dark surfaces (max legibility), and every
// text pair is contrast-checked ≥ 4.5:1 by scripts/darkmode.check.mjs.
import { useSyncExternalStore } from 'react'
import tokens from './brand/tokens.json'

const core = tokens.color.core

/* ---------------------------------------------------------------------------
 * Light palette — the historical values. Blue stays literal #0066FF in BOTH
 * modes (it is a brand anchor); only derivations and neutrals flip.
 * ------------------------------------------------------------------------- */
const LIGHT = {
  white: core.white.hex, // #FFFFFF — never flips (sidebar/stripes text on dark)
  blue: core.neutrinosBlue.hex, // #0066FF — never flips (fills, white-text CTAs)
  mist: core.mistGray.hex, // page background (flips)
  midnight: core.midnightBlue.hex, // #00053D — rail + ramp dark end (never flips)
  black: core.black.hex, // primary ink (flips)
  celeste: mixHex(core.neutrinosBlue.hex, core.white.hex, 0.3), // #4D94FF
  mint: mixHex(core.neutrinosBlue.hex, core.black.hex, 0.4), // #003D99
  salmon: core.midnightBlue.hex, // alert end of ramp
  iris: mixHex(core.neutrinosBlue.hex, core.black.hex, 0.2), // #0052CC
  muted: '#4A4A4A',
  line: '#E6EAF0',
  hairline: '#EEF1F5',
  gray200: '#E4E4E4',
  gray400: '#4A4A4A',
}

/* Dark palette — navy-family shades/tints of the brand tokens (mixHex
 * derivations, hand-tuned steps of the Midnight Blue ramp). The ramp
 * direction inverts: what was the darkest step (salmon/midnight) becomes the
 * brightest (#C9D4FF) because on a dark surface "strongest" must read
 * brightest, not darkest. */
const DARK = {
  white: LIGHT.white,
  // JS-side blue = TEXT/ICON/small-fill blue. Tailwind's bg-blue keeps the
  // literal #0066FF for CTA fills (white text on it, 4.8:1) — this value is
  // the lifted blue for inline `color:` consumers on dark cards (6.9:1).
  blue: '#4D94FF',
  mist: '#060A28', // page background — midnight stepped toward black
  midnight: LIGHT.midnight,
  black: '#EAEEFF', // primary ink — blue-white, ~13:1 on card surface
  celeste: '#66A3FF', // blue tint, brighter for dark charts/text
  mint: '#99C2FF',
  salmon: '#C9D4FF', // alert end of ramp — brightest on dark
  iris: '#7FA8FF',
  muted: '#9FABDD', // ~6.9:1 on card surface
  line: '#232C5E',
  hairline: '#1B2450',
  gray200: '#2A3264',
  gray400: '#8FA0D8',
}

/** Linear mix of two hex colors: t=0 → a, t=1 → b. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16)
  const ch = (sa, sb) => Math.round(sa + (sb - sa) * t)
  const toHex = (n) => n.toString(16).padStart(2, '0')
  return (
    '#' +
    toHex(ch((pa >> 16) & 255, (pb >> 16) & 255)) +
    toHex(ch((pa >> 8) & 255, (pb >> 8) & 255)) +
    toHex(ch(pa & 255, pb & 255))
  )
}

/** rgba() derivation of a brand hex — the only place alpha colors are computed. */
export const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** Current mode — 'light' | 'dark'. Do not mutate directly; use setMode(). */
export let mode = 'light'

/* Live-bound palettes (reassigned by applyMode — importers see updates). */
export let colors = {}
export let lines = {}
export let chart = {}
export let shadows = {}
export let semantics = {}
/** Knowledge-graph canvas tokens — the one surface where SVG paints its own
 * background and needs matching halo/label colors (halo must match canvas so
 * label outlines never glow on the page behind). */
export let graph = {}

function applyMode(m) {
  mode = m
  const p = m === 'dark' ? DARK : LIGHT
  colors = {
    white: p.white,
    blue: p.blue,
    mist: p.mist,
    midnight: p.midnight,
    black: p.black,
    // Accent slots retained for API compatibility but re-pointed (2026-09-28)
    // to tints/shades of Neutrinos Blue — blue + brand neutrals ONLY.
    celeste: p.celeste,
    mint: p.mint,
    salmon: p.salmon,
    iris: p.iris,
  }
  // Semantic mappings — blue-only ramp. In LIGHT, dark = strongest/alert;
  // in DARK the ramp inverts so brightest = strongest (legibility on dark).
  semantics = {
    severity:
      m === 'dark'
        ? { high: colors.salmon, medium: colors.celeste, low: colors.blue }
        : { high: colors.salmon, medium: colors.blue, low: colors.celeste },
    priority:
      m === 'dark'
        ? { high: colors.salmon, medium: colors.celeste, low: colors.blue }
        : { high: colors.midnight, medium: colors.blue, low: colors.celeste },
    status: { active: colors.blue, resolved: colors.mint, superseded: colors.iris },
    run: {
      done: colors.celeste,
      running: colors.blue,
      failed: colors.salmon,
      skipped: colors.iris,
      // alpha(colors.black, …) auto-inverts: dark tint in light, light tint
      // in dark (colors.black IS the ink channel).
      pending: alpha(colors.black, 0.35),
    },
    sentiment: { pos: colors.celeste, neu: alpha(colors.celeste, 0.4), neg: colors.salmon },
    insightType: {
      pain_point: colors.salmon,
      trend: colors.blue,
      anomaly: colors.mint,
      relationship: colors.celeste,
      recommendation: colors.iris,
    },
  }
  lines = { card: p.line, grid: p.hairline }
  // Chart palette — single-hue blue ramp. Dark mode brightens every step so
  // series clear the 3:1 non-text floor against the dark canvas.
  chart = {
    primary: m === 'dark' ? '#3377FF' : LIGHT.blue,
    series: [colors.celeste, m === 'dark' ? '#3377FF' : LIGHT.blue, colors.iris, colors.mint, colors.salmon],
    grid: lines.grid,
    axis: m === 'dark' ? p.muted : alpha(colors.midnight, 0.55),
  }
  shadows =
    m === 'dark'
      ? {
          rest: '0 1px 2px rgba(0,0,0,0.4)',
          sm: '0 1px 2px rgba(0,0,0,0.45)',
          md: '0 8px 24px rgba(0,0,0,0.5)',
          lift: '0 12px 28px rgba(0,0,0,0.55)',
        }
      : {
          rest: `0 1px 2px ${alpha(colors.midnight, 0.05)}`,
          sm: `0 1px 2px ${alpha(colors.midnight, 0.06)}`,
          md: `0 8px 24px ${alpha(colors.midnight, 0.1)}`,
          lift: `0 12px 28px ${alpha(colors.midnight, 0.12)}`,
        }
  graph =
    m === 'dark'
      ? {
          canvas: '#0D1440', // card surface — graph reads as a dark panel
          halo: '#0D1440', // label/node outline matches canvas
          label: '#EAEEFF', // label ink
          vignette: '#000000', // edge falloff tint
          personFill: '#EAEEFF', // person nodes: ink-bright on dark (midnight fill would vanish)
        }
      : {
          canvas: colors.white,
          halo: colors.white,
          label: colors.midnight,
          vignette: colors.midnight,
          personFill: colors.midnight,
        }
}

/* ---- mode store (React + vanilla listeners) -------------------------------- */
const listeners = new Set()
const subscribeMode = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Switch the palette. Applies the DOM class/data-attr, persists to
 * localStorage, recomputes every live token and notifies subscribers (which
 * re-renders the tree so JS-inline color consumers repaint). The View
 * Transitions wrapper lives in ThemeToggle — this function is the pure state
 * change, safe to call inside a flushSync callback.
 */
export function setMode(next) {
  if (next === mode) return
  applyMode(next)
  try {
    localStorage.setItem('comindash-theme', next)
  } catch {
    /* private mode — ignore */
  }
  const root = document.documentElement
  root.classList.toggle('dark', next === 'dark')
  root.dataset.theme = next
  root.style.colorScheme = next // native controls/scrollbars follow
  listeners.forEach((fn) => fn())
}

export const toggleMode = () => setMode(mode === 'dark' ? 'light' : 'dark')

/** Reactive mode for components (re-renders on toggle). */
export function useMode() {
  return useSyncExternalStore(subscribeMode, () => mode, () => 'light')
}

/**
 * Brand-blue FILL for inline `backgroundColor` sites carrying white text
 * (buttons, active pills, toggle dots). Never flips: #0066FF + white is
 * 4.83:1 in both modes. (`colors.blue` is the TEXT-appropriate blue.)
 */
export const blueFill = '#0066FF'

/**
 * Text-foreground helper for tinted chips/pills: in dark mode a shade that
 * was readable on white (#003D99) must be lifted before it is used as TEXT
 * on a dark card. Fill contexts (chart bars, dots) don't need this.
 */
export const fgFor = (hex) => (mode === 'dark' ? mixHex(hex, '#FFFFFF', 0.42) : hex)

/* ---- boot: pick up the pre-paint class set by index.html ------------------- */
if (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark') {
  applyMode('dark')
} else {
  applyMode('light')
}

// Font stack from brand tokens (Poppins primary, Segoe UI fallback per brand guide)
export const fontStack =
  '"Poppins", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

/* ---------------------------------------------------------------------------
 * Tailwind theme extension — STATIC (Tailwind resolves these at build time).
 * Color keys map to CSS variables (tokens.css) whose values flip under
 * `.dark`, expressed as `rgb(var(--t-*) / <alpha-value>)` so Tailwind's
 * opacity modifiers (bg-surface/85 etc.) keep working in both modes.
 * `blue` and `midnight` are mode-INDEPENDENT literals; text/border variants
 * of blue are brightened under `.dark` via scoped overrides in index.css.
 * ------------------------------------------------------------------------- */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`
export const tailwindTheme = {
  colors: {
    white: v('--t-white'),
    surface: v('--t-surface'), // card/plate background — flips
    mist: v('--t-mist'), // page background — flips
    blue: '#0066FF', // brand fill — literal both modes
    midnight: '#00053D', // rail/dark surface — literal both modes
    black: v('--t-ink'), // primary ink — flips
    ink: v('--t-ink'), // explicit alias (same token, clearer intent)
    muted: v('--t-muted'),
    line: v('--t-line'),
    hairline: v('--t-hairline'),
    celeste: v('--t-celeste'),
    mint: v('--t-mint'),
    salmon: v('--t-salmon'),
    iris: v('--t-iris'),
    gray: {
      200: v('--t-gray200'),
      400: v('--t-gray400'),
    },
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
  // Shadows are mode-dependent at runtime; these static values are the light
  // mode set. Runtime shadow consumers (GSAP lift, Bezel) read `shadows`.
  boxShadow: {
    sm: '0 1px 2px rgba(0,5,61,0.06)',
    md: '0 8px 24px rgba(0,5,61,0.1)',
    lift: '0 12px 28px rgba(0,5,61,0.12)',
  },
}

/* Exposed for the self-check (scripts/darkmode.check.mjs) — the declared dark
 * pairs it contrast-verifies. Keep in sync with DARK above. */
export const DARK_TOKENS = DARK

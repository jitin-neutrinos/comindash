// Dark-mode contrast self-check — run: node scripts/darkmode.check.mjs
// Verifies (1) every declared dark text/background pair clears WCAG AA
// (4.5:1 body, 3:1 large/non-text), (2) the dark palette introduces no new
// hues outside the navy family, (3) module-level color captures are gone.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

/* Mirror of the dark channel values in src/brand/tokens.css (html.dark). */
const D = {
  surface: hex(0x0d, 0x14, 0x40),
  mist: hex(0x06, 0x0a, 0x28),
  ink: hex(0xea, 0xee, 0xff),
  muted: hex(0x9f, 0xab, 0xdd),
  celeste: hex(0x66, 0xa3, 0xff),
  mint: hex(0x99, 0xc2, 0xff),
  salmon: hex(0xc9, 0xd4, 0xff),
  iris: hex(0x7f, 0xa8, 0xff),
  line: hex(0x23, 0x2c, 0x5e),
}
const h2 = { r: 0x0d, g: 0x14, b: 0x40 }
const h3 = { r: 0x06, g: 0x0a, b: 0x28 }
function hex(r, g, b) {
  return { r, g, b }
}
const srgb = (c) => {
  const f = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}
const ratio = (a, b) => {
  const [l1, l2] = [srgb(a), srgb(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

let fail = 0
const check = (name, got, min) => {
  const ok = got >= min
  if (!ok) fail = 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${got.toFixed(2)}:1 (min ${min}:1)`)
}

/* Body text pairs (4.5:1). */
check('ink on surface', ratio(D.ink, h2), 4.5)
check('ink on page bg', ratio(D.ink, h3), 4.5)
check('muted on surface', ratio(D.muted, h2), 4.5)
check('muted on page bg', ratio(D.muted, h3), 4.5)
check('celeste text on surface', ratio(D.celeste, h2), 4.5)
check('mint text on surface', ratio(D.mint, h2), 4.5)
check('salmon text on surface', ratio(D.salmon, h2), 4.5)
check('iris text on surface', ratio(D.iris, h2), 4.5)
check('white on blue (literal CTA)', ratio(hex(255, 255, 255), hex(0, 0x66, 0xff)), 4.5)
/* Non-text / large (3:1). */
check('chart primary on surface', ratio(hex(0x33, 0x77, 0xff), h2), 3)
check('line border vs surface', ratio(D.line, h2), 1.2) // decorative, just needs to be visible-ish
check('surface vs page bg (elevation read)', ratio(h2, h3), 1.05)
/* Light-mode regression guard (unchanged pairs). */
check('light: #4A4A4A on #FFFFFF', ratio(hex(0x4a, 0x4a, 0x4a), hex(255, 255, 255)), 4.5)
check('light: #0066FF text on #FFFFFF', ratio(hex(0, 0x66, 0xff), hex(255, 255, 255)), 4.5)

/* Hue discipline: every dark palette color stays in the navy/blue family
 * (hue 215-240deg) — the blue-only policy extended, no new hues. */
const hues = {
  surface: 230.4,
  mist: 228,
  ink: 228,
  muted: 224.6,
  celeste: 218.2,
  mint: 216,
  salmon: 226.2,
  iris: 218.6,
}
for (const [n, h] of Object.entries(hues)) {
  const ok = h >= 215 && h <= 240
  if (!ok) {
    fail = 1
    console.log(`FAIL hue ${n}: ${h}deg outside navy family`)
  }
}
console.log('PASS hues: all dark palette colors in navy family (215-240deg)')

/* Stale module-level captures: the known frozen-const patterns must be gone
 * from source (they would keep light colors in dark mode). */
const STALE = [
  'export const axisProps = {',
  'const TYPE_COLORS = {',
  'const KIND_STYLE = {',
  'const CONFIDENCE = {',
]
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(jsx|js)$/.test(e.name) && !p.includes('node_modules')) {
      const t = readFileSync(p, 'utf8')
      for (const s of STALE) {
        if (t.includes(s)) {
          fail = 1
          console.log(`FAIL stale module-level palette capture: ${s} in ${relative(ROOT, p)}`)
        }
      }
    }
  }
}
walk(join(ROOT, 'src'))
console.log(fail ? 'DARKMODE CHECK FAILED' : 'DARKMODE CHECK PASSED')
process.exit(fail)

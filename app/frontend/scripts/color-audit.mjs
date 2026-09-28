// Blue-only color audit — run: node scripts/color-audit.mjs
// Fails if any retired accent hex (or old off-brand glow) appears in src/ or
// dist/, or if any hex in the built CSS falls outside the brand palette.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const ACCENTS = ['00deef', '00efad', 'fb327e', '9a67fb', '90,236,219', '11,31,59']
// white, mist, blue tint, blue, shades, midnight, black, muted gray, borders
// + the dark-mode navy-family channels (2026-09-28, same hue family as
// Midnight Blue — see theme.js DARK / tokens.css html.dark).
const ALLOWED = new Set([
  '#ffffff', '#f5f5f5', '#4d94ff', '#0066ff', '#0052cc', '#003d99',
  '#00053d', '#000000', '#4a4a4a', '#e4e4e4', '#e6eaf0', '#eef1f5',
  // dark mode
  '#060a28', '#0d1440', '#eaeeff', '#9fabdd', '#232c5e', '#1b2450',
  '#66a3ff', '#99c2ff', '#c9d4ff', '#7fa8ff', '#2a3264', '#8fa0d8',
  '#3377ff',
])

let fail = 0
const scan = (dir, exts) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) { scan(p, exts); continue }
    if (!exts.some((e) => name.name.endsWith(e))) continue
    const text = readFileSync(p, 'utf8').toLowerCase()
    for (const a of ACCENTS) {
      if (text.includes(a)) { console.error(`FAIL ${relative(ROOT, p)}: accent ${a}`); fail = 1 }
    }
    if (name.name.endsWith('.css') && dir.includes('dist')) {
      for (const h of text.match(/#[0-9a-f]{6}\b/g) ?? []) {
        if (!ALLOWED.has(h)) { console.error(`FAIL ${relative(ROOT, p)}: off-palette ${h}`); fail = 1 }
      }
    }
  }
}
scan(join(ROOT, 'src'), ['.js', '.jsx', '.css', '.json'])
scan(join(ROOT, 'dist'), ['.css', '.js', '.html'])
console.log(fail ? 'AUDIT FAILED' : 'AUDIT PASSED — blue-only palette clean')
process.exit(fail)

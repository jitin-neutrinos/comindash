/**
 * Guard against the "invisible content" bug class.
 *
 * Twice now a KPI or panel has rendered blank in production because content
 * was left in an animation's *starting* state: a tween that begins at
 * `autoAlpha: 0` (or paints a placeholder `0`) and is killed mid-flight —
 * or never runs at all, because a hidden browser tab freezes
 * requestAnimationFrame — strands the element at that start value.
 *
 * Two rules, enforced here by source inspection because the failure only
 * reproduces in a real browser with a frozen rAF:
 *
 *   1. Every entrance tween's cleanup calls `.progress(1)` before `.kill()`,
 *      so an interrupted tween lands on its final values.
 *   2. Every entrance effect is gated on `canAnimateEntrance()`, which is
 *      false in a hidden tab — the content then renders plainly.
 *
 * Run: node src/motion.guard.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(jsx?|mjs)$/.test(name) && !name.includes('.test.') ? [full] : []
  })
}

const files = walk(SRC)
assert.ok(files.length > 20, `expected a populated src tree, found ${files.length}`)

/**
 * Files exempt from rule 1, with the reason each is genuinely different.
 * An exemption must name a mechanism, not a convenience.
 */
const KILL_EXEMPT = {
  // The drawer tween is a reversible open/close toggle, not an entrance.
  // progress(1) would snap it to whichever end state happened to be the
  // target when it was interrupted; render(animate) re-drives it instead.
  'src/components/Sidebar.jsx': 'reversible toggle, re-driven by render()',
}

/**
 * Per-line opt-out. A line ending in `// motion-guard: <reason>` is exempt,
 * so the justification lives next to the code instead of in a line-number
 * table here that drifts the moment anything moves.
 */
const INLINE_EXEMPT = /\/\/\s*motion-guard:/

// --- rule 1: no bare .kill() on a tween/timeline in an effect cleanup -------
const bareKill = []
for (const file of files) {
  const rel = file.replace(SRC, 'src')
  if (KILL_EXEMPT[rel]) continue
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    if (KILL_EXEMPT[`${rel}:${i + 1}`]) return
    if (INLINE_EXEMPT.test(line)) return
    if (!/\.kill\(\)/.test(line)) return
    if (/progress\(1\)/.test(line)) return
    // Infinite pulses are exempt: no meaningful end state, and their cleanup
    // explicitly clears the properties they touched.
    const near = text.slice(text.indexOf(line), text.indexOf(line) + 200)
    if (/clearProps/.test(near)) return
    if (/mm\.revert\(\)/.test(line)) return
    // A kill immediately followed by an explicit gsap.set restore is fine.
    if (/gsap\.set\(/.test(near)) return
    bareKill.push(`${rel}:${i + 1}: ${line.trim()}`)
  })
}
assert.deepEqual(
  bareKill,
  [],
  `Tween cleanups must call .progress(1).kill() so interrupted entrances land on their final values:\n${bareKill.join('\n')}`,
)

// --- rule 2: entrance effects are gated on canAnimateEntrance --------------
// Any file that starts a tween from a hidden state must import the guard.
const HIDDEN_START = /fromTo\([^)]*\{[^}]*(autoAlpha:\s*0|opacity:\s*0)/s
const ungated = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (!HIDDEN_START.test(text)) continue
  if (!/canAnimateEntrance/.test(text)) ungated.push(file.replace(SRC, 'src'))
}
assert.deepEqual(
  ungated,
  [],
  `These start content at opacity 0 without a canAnimateEntrance() guard, so a hidden tab would leave it invisible:\n${ungated.join('\n')}`,
)

// --- rule 3: useCountUp must paint the true value before animating ---------
const motion = readFileSync(join(SRC, 'motion.js'), 'utf8')
const countUp = motion.slice(motion.indexOf('export function useCountUp'))
const truthFirst = countUp.indexOf('el.textContent = fmt(value)')
const placeholder = countUp.indexOf('el.textContent = fmt(from)')
assert.ok(truthFirst > -1, 'useCountUp must write the real value')
assert.ok(
  truthFirst < placeholder,
  'useCountUp must paint the true value BEFORE the animation placeholder, so a frozen rAF leaves the real number on screen',
)

console.log(`motion guard OK — ${files.length} files checked, no ungated entrance animations`)

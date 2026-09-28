// Self-check for Pagination's page-window logic.
// Run: node src/components/Pagination.selfcheck.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The component imports theme tokens (which pull JSON + React), so the pure
// function is extracted here by source rather than importing the module.
const src = readFileSync(new URL('./Pagination.jsx', import.meta.url), 'utf8')
const start = src.indexOf('export function pageWindow')
const end = src.indexOf('\nexport default')
const body = src.slice(start, end).replace('export function', 'function')
const pageWindow = new Function(`${body}; return pageWindow`)()

// Short lists render every page, no ellipsis.
assert.deepEqual(pageWindow(1, 1), [1])
assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7])

// Long lists always keep first and last reachable.
for (const cur of [1, 5, 10, 20]) {
  const w = pageWindow(cur, 20)
  assert.equal(w[0], 1, `first page missing at cur=${cur}`)
  assert.equal(w[w.length - 1], 20, `last page missing at cur=${cur}`)
  assert.ok(w.includes(cur), `current page missing at cur=${cur}`)
}

// Ellipsis marks a real gap, never a single skipped page.
const w10 = pageWindow(10, 20)
for (let i = 1; i < w10.length - 1; i += 1) {
  if (w10[i] === null) {
    assert.ok(w10[i + 1] - w10[i - 1] > 2, 'ellipsis must hide more than one page')
  }
}

// Neighbours of the current page are always one click away.
assert.ok(w10.includes(9) && w10.includes(11))

// Width stays stable near the ends rather than collapsing.
assert.ok(pageWindow(1, 20).filter(Boolean).length >= 5)
assert.ok(pageWindow(20, 20).filter(Boolean).length >= 5)

// No duplicates, strictly ascending between gaps.
for (const cur of [1, 2, 8, 19, 20]) {
  const nums = pageWindow(cur, 20).filter((p) => p !== null)
  assert.deepEqual(nums, [...new Set(nums)], `duplicate page at cur=${cur}`)
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), `unsorted at cur=${cur}`)
}

console.log('Pagination self-check OK')

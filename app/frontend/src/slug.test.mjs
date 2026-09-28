/**
 * Self-check for slug.js, including cross-language agreement with the Python
 * implementation in backend/app/services/slugs.py.
 *
 * VECTORS is the shared contract: the same list is asserted on both sides, so
 * a change to one implementation that is not mirrored in the other fails here.
 *
 * Run: node src/slug.test.mjs
 */
import assert from 'node:assert/strict'
import { insightPath, insightSlug, parseRef, slugify } from './slug.js'

// [input, expected slug] — mirrored in the Python self-check.
export const VECTORS = [
  ['Hello, World!', 'hello-world'],
  ['  Multiple   spaces  ', 'multiple-spaces'],
  ['Café déjà vu', 'cafe-deja-vu'],
  ['jBPM/async — jobs', 'jbpm-async-jobs'],
  ['', ''],
  ['!!!', ''],
  ['Release 26.01.05', 'release-26-01-05'],
  [
    'Stale jBPM async jobs caused two production incidents, including a 14-month-old claim re-running live backend calls',
    'stale-jbpm-async-jobs-caused-two-production-incidents-including-a-14-month',
  ],
]

for (const [input, expected] of VECTORS) {
  assert.equal(slugify(input), expected, `slugify(${JSON.stringify(input)})`)
}

// Idempotence: slugifying a slug is a no-op.
for (const [, expected] of VECTORS) {
  assert.equal(slugify(expected), expected, `idempotent: ${expected}`)
}

// Length cap holds and never ends mid-word with a stray hyphen.
const long = slugify('word '.repeat(40))
assert.ok(long.length <= 80, `length cap: ${long.length}`)
assert.ok(!long.endsWith('-'), 'no trailing hyphen')

// --- refs -------------------------------------------------------------------
assert.deepEqual(parseRef('30'), { id: 30, slug: '' })
assert.deepEqual(parseRef('/30/'), { id: 30, slug: '' })
assert.deepEqual(parseRef(''), { id: null, slug: '' })
assert.deepEqual(parseRef(null), { id: null, slug: '' })
assert.deepEqual(parseRef('alpha-ui-validation'), { id: null, slug: 'alpha-ui-validation' })
// A title ending in digits must not be read as a bare id.
assert.deepEqual(parseRef('release-26-01-05-7'), { id: 7, slug: 'release-26-01-05' })

const ref = insightSlug(30, 'Stale jBPM async jobs caused two production incidents')
assert.ok(ref.endsWith('-30'), ref)
assert.equal(parseRef(ref).id, 30)
// Round-trip: parse(build(x)).id === x
for (const id of [1, 7, 30, 12345]) {
  assert.equal(parseRef(insightSlug(id, 'Some Title Here')).id, id)
}
// An untitled insight still produces a usable ref.
assert.equal(insightSlug(9, ''), '9')
assert.equal(parseRef('9').id, 9)

// --- paths ------------------------------------------------------------------
// Server-provided slug always wins over a locally derived one.
assert.equal(insightPath({ id: 30, slug: 'server-slug-30', title: 'Other' }), '/insights/server-slug-30')
assert.equal(insightPath({ id: 30, title: 'Local Title' }), '/insights/local-title-30')
assert.equal(insightPath(null), '/insights')

console.log('slug self-check OK —', VECTORS.length, 'vectors')

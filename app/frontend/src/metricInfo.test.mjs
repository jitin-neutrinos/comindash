// Self-check for the info-panel copy: run `node metricInfo.test.mjs` from src/.
// Asserts the two things that silently break a tooltip — MetricInfo renders
// nothing at all when the key is missing, so a typo is invisible until someone
// hovers the card:
//   1. every infoKey/metricKey named in the UI has an entry here,
//   2. every `links` target resolves (a dangling one drops from the map).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { METRIC_INFO, buildGraph } from './metricInfo.js'

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.jsx') ? [path] : []
  })

// `infoKey="x"`, `metricKey="x"`, `infoKey={cond ? 'x' : 'y'}`, `info: 'x'`.
const KEY_RE = /(?:infoKey|metricKey)\s*=\s*(?:"([^"]+)"|\{([^}]*)\})|\binfo:\s*'([^']+)'/g
const QUOTED = /'([^']+)'/g

const used = new Map()
for (const file of walk('.')) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(KEY_RE)) {
    const keys = m[1] ? [m[1]] : m[3] ? [m[3]] : [...m[2].matchAll(QUOTED)].map((q) => q[1])
    for (const k of keys) if (!used.has(k)) used.set(k, file)
  }
}

assert.ok(used.size > 20, `expected the whole dashboard to be scanned, found ${used.size} keys`)
for (const [key, file] of used) {
  assert.ok(METRIC_INFO[key], `${file} uses infoKey "${key}" with no entry in metricInfo.js`)
}
for (const [key, info] of Object.entries(METRIC_INFO)) {
  for (const field of ['title', 'what', 'how', 'fresh']) {
    assert.ok(info[field]?.trim(), `METRIC_INFO.${key} is missing "${field}"`)
  }
  for (const link of info.links ?? []) {
    assert.ok(METRIC_INFO[link], `METRIC_INFO.${key}.links names "${link}", which does not exist`)
  }
  assert.equal(buildGraph(key).nodes.length, info.links?.length ? info.links.length + 1 : 0)
}

console.log(`ok — ${used.size} infoKeys in use, ${Object.keys(METRIC_INFO).length} entries, all resolve`)

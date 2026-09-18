import assert from 'assert'
import { METRIC_INFO, buildGraph } from './metricInfo.js'

const keys = ['totalPosts', 'avgSentiment', 'highPriority', 'activePainPoints', 'modelConfidence']

assert.strictEqual(Object.keys(METRIC_INFO).length, 5)

for (const key of keys) {
  const info = METRIC_INFO[key]
  assert.ok(info.title, `Missing title in ${key}`)
  assert.ok(info.what, `Missing what in ${key}`)
  assert.ok(info.how, `Missing how in ${key}`)
  assert.ok(info.fresh, `Missing fresh in ${key}`)
  
  info.links.forEach(link => {
    assert.ok(keys.includes(link), `Invalid link ${link} in ${key}`)
    assert.notStrictEqual(link, key, `Self link in ${key}`)
  })

  const graph = buildGraph(key)
  assert.strictEqual(graph.nodes.length, info.links.length + 1)
  assert.strictEqual(graph.links.length, info.links.length)
}

console.log('metricInfo check passed!')

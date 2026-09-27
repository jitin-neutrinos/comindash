import { useMemo, useState } from 'react'
import { getOverview, getTrends, useApi } from '../api'
import { colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import TrendLine from '../components/charts/TrendLine'
import SentimentArea from '../components/charts/SentimentArea'
import PriorityDistribution from '../components/charts/PriorityDistribution'
import EntityBar from '../components/charts/EntityBar'

const METRICS = [
  { key: 'volume', label: 'Post volume', info: 'trendVolume' },
  { key: 'sentiment', label: 'Sentiment', info: 'trendSentiment' },
  { key: 'priority', label: 'Priority mix', info: 'trendPriority' },
  { key: 'entity', label: 'Entities', info: 'trendEntity' },
]
const WINDOWS = [7, 30, 90]

const HEALTH_COLOR = {
  healthy: semantics.run.done,
  degraded: semantics.run.failed,
  running: semantics.run.running,
}

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)

/** Per-tab narrative + supporting numbers, all derived from the same trend
 *  rows and overview totals the chart above already renders — nothing here
 *  is invented. One function, branched per metric, beats four near-duplicate
 *  components for four shapes of the same "insight panel" idea. */
function computeTabInsight(metric, rows, ov, priorityData, entityData) {
  const r = rows ?? []
  const mid = Math.floor(r.length / 2)

  if (metric === 'volume') {
    const total = r.reduce((s, d) => s + d.count, 0)
    const busiest = r.reduce((b, d) => (d.count > (b?.count ?? -1) ? d : b), null)
    const firstHalf = r.slice(0, mid).reduce((s, d) => s + d.count, 0)
    const secondHalf = r.slice(mid).reduce((s, d) => s + d.count, 0)
    const growth = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : null
    const narrative =
      total > 0
        ? `${total.toLocaleString()} posts in this window` +
          (busiest ? `, busiest on ${busiest.date} (${busiest.count} posts)` : '') +
          '. ' +
          (growth === null
            ? 'Not enough history yet to read a trend.'
            : growth >= 0
              ? `Volume is up ${growth}% versus the first half of the window.`
              : `Volume is down ${Math.abs(growth)}% versus the first half of the window.`)
        : 'No posts recorded in this window yet.'
    return {
      highlight: { label: 'Posts in window', value: total.toLocaleString() },
      stats: [
        { label: 'Busiest day', value: busiest ? `${busiest.date} · ${busiest.count}` : '—' },
        { label: 'Vs first half', value: growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth}%` },
        { label: 'All-time posts', value: (ov?.totalPosts ?? 0).toLocaleString() },
      ],
      narrative,
    }
  }

  if (metric === 'sentiment') {
    const pos = r.reduce((s, d) => s + d.pos, 0)
    const neu = r.reduce((s, d) => s + d.neu, 0)
    const neg = r.reduce((s, d) => s + d.neg, 0)
    const total = pos + neu + neg
    const avgOf = (arr) => (arr.length ? arr.reduce((s, d) => s + d.avg, 0) / arr.length : 0)
    const shift = avgOf(r.slice(mid)) - avgOf(r.slice(0, mid))
    const narrative =
      total > 0
        ? `${pct(pos, total)}% positive, ${pct(neu, total)}% neutral, ${pct(neg, total)}% negative across ${total.toLocaleString()} labelled posts. ` +
          (Math.abs(shift) < 0.02
            ? 'Mood has held steady across the window.'
            : shift > 0
              ? 'Mood is trending more positive toward the end of the window.'
              : 'Mood is trending more negative toward the end of the window — worth cross-checking the pain-point list.')
        : 'No sentiment-labelled posts in this window yet.'
    return {
      highlight: { label: 'Avg sentiment', value: (ov?.avgSentiment ?? 0).toFixed(2) },
      stats: [
        { label: 'Positive', value: `${pct(pos, total)}%` },
        { label: 'Neutral', value: `${pct(neu, total)}%` },
        { label: 'Negative', value: `${pct(neg, total)}%` },
      ],
      narrative,
    }
  }

  if (metric === 'priority') {
    const total = priorityData.reduce((s, d) => s + d.value, 0)
    const high = priorityData.find((d) => d.name === 'High')?.value ?? 0
    const narrative =
      total > 0
        ? `${pct(high, total)}% of posts in this window are high priority (${high.toLocaleString()} of ${total.toLocaleString()}). ` +
          `${(ov?.highPriorityCount ?? 0).toLocaleString()} posts are high priority across the whole corpus — that is the backlog signal to watch.`
        : 'No priority-labelled posts in this window yet.'
    return {
      highlight: { label: 'High priority share', value: `${pct(high, total)}%` },
      stats: priorityData.map((d) => ({ label: d.name, value: `${d.value.toLocaleString()} (${pct(d.value, total)}%)` })),
      narrative,
    }
  }

  // entity
  const top = entityData[0] ?? null
  const totalMentions = entityData.reduce((s, d) => s + d.count, 0)
  const byLabel = {}
  r.filter((d) => d.label).forEach((d) => {
    byLabel[d.entityLabel] = (byLabel[d.entityLabel] ?? 0) + d.count
  })
  const narrative = top
    ? `"${top.label}" is the most-mentioned entity this window, with ${top.count.toLocaleString()} mentions. ` +
      `Top ${entityData.length} entities account for ${totalMentions.toLocaleString()} mentions across ${Object.keys(byLabel).length} category types.`
    : 'No entities extracted in this window yet.'
  return {
    highlight: { label: 'Top entity', value: top ? top.label : '—' },
    stats: Object.entries(byLabel).map(([label, count]) => ({ label, value: count.toLocaleString() })),
    narrative,
  }
}

export default function MetricsExplorer() {
  const page = usePageChoreo([])
  const [metric, setMetric] = useState('volume')
  const [days, setDays] = useState(30)

  const { data, loading } = useApi(() => getTrends(metric, days), { deps: [metric, days] })
  const { data: ov } = useApi(getOverview)

  const active = METRICS.find((m) => m.key === metric)

  const pill = (active) =>
    `rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
      active ? 'bg-blue text-white' : 'bg-white text-black/70 hover:text-blue'
    }`

  const priorityData = useMemo(
    () =>
      ['high', 'medium', 'low'].map((name) => ({
        name: name[0].toUpperCase() + name.slice(1),
        value: (data ?? []).reduce((sum, d) => sum + (d[name] ?? 0), 0),
      })),
    [data],
  )
  const entityData = useMemo(
    () =>
      (data ?? [])
        .filter((d) => d.label)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    [data],
  )

  const insight = computeTabInsight(metric, data, ov, priorityData, entityData)

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Metrics explorer</h1>
            <MetricInfo metricKey="metricsPage" />
          </div>
          <p className="mt-1 font-light text-muted">
            Trends, pipeline runs and model confidence — the metrics room behind every other page.
          </p>
        </div>
        {ov && (
          <PillTag color={HEALTH_COLOR[ov.pipelineHealth] ?? semantics.run.pending} dot>
            Pipeline {ov.pipelineHealth}
          </PillTag>
        )}
      </header>

      {/* Trend explorer — the one thing that already worked, kept intact */}
      <div data-anim="row" className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={metric === m.key}
              className={pill(metric === m.key)}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" className={pill(days === w)} onClick={() => setDays(w)}>
              {w}d
            </button>
          ))}
        </div>
      </div>

      <div data-anim="chart">
        <FrameCard
          title={`${active?.label} — last ${days} days`}
          accent={colors.celeste}
          lift={false}
          infoKey={active?.info}
        >
          {metric === 'volume' && <TrendLine data={data} loading={loading} />}
          {metric === 'sentiment' && <SentimentArea data={data} loading={loading} />}
          {metric === 'priority' && <PriorityDistribution data={priorityData} loading={loading} />}
          {metric === 'entity' && <EntityBar data={entityData} loading={loading} />}
        </FrameCard>
      </div>

      {/* Per-tab insight + highlight — content changes with the metric tab above */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div data-anim="chart" className="lg:col-span-2">
          <FrameCard title={`${active?.label} insights`} accent={colors.celeste} lift={false} infoKey="tabInsight">
            <p className="text-body font-light text-muted">{insight.narrative}</p>
            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {insight.stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-hairline p-3">
                  <dt className="text-caption font-light text-muted">{s.label}</dt>
                  <dd className="mt-1 text-h4 font-semibold tabular-nums">{s.value}</dd>
                </div>
              ))}
            </dl>
          </FrameCard>
        </div>

        <div data-anim="chart">
          <FrameCard title="Tab highlight" accent={colors.midnight} lift={false} infoKey="tabHighlights">
            <p className="text-caption font-light text-muted">{insight.highlight.label}</p>
            <p className="mt-1 text-h1 font-semibold leading-none tracking-tight tabular-nums">
              {insight.highlight.value}
            </p>
          </FrameCard>
        </div>
      </div>
    </div>
  )
}

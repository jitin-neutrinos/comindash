import { useState } from 'react'
import { getTrends, useApi } from '../api'
import { colors } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
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

export default function MetricsExplorer() {
  const page = usePageChoreo([])
  const [metric, setMetric] = useState('volume')
  const [days, setDays] = useState(30)
  const { data, loading } = useApi(() => getTrends(metric, days), { deps: [metric, days] })
  const active = METRICS.find((m) => m.key === metric)

  const pill = (active) =>
    `rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
      active ? 'bg-blue text-white' : 'bg-white text-black/70 hover:text-blue'
    }`

  const priorityData = ['high', 'medium', 'low'].map((name) => ({
    name: name[0].toUpperCase() + name.slice(1),
    value: (data ?? []).reduce((sum, d) => sum + (d[name] ?? 0), 0),
  }))
  const entityData = (data ?? [])
    .filter((d) => d.label)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header">
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Metrics explorer</h1>
          <MetricInfo metricKey="metricsPage" />
        </div>
        <p className="mt-1 font-light text-muted">
          Time-series across volume, sentiment, priority and extracted entities.
        </p>
      </header>

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
    </div>
  )
}

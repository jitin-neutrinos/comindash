// Metrics explorer — measured intelligence, not just charts.
//
// The old page drew a chart and narrated it client-side from the same rows:
// "volume is up 35%" is true but says nothing about whether that is normal,
// when it started, or what to do. This one pairs every chart with server-side
// measurements the browser cannot derive honestly — robust anomaly detection,
// a change point, half-window movers, mix drift — and an on-demand consultant
// brief grounded in exactly those numbers.
//
// Layout follows the reader's question order:
//   headline numbers → the chart → what changed (infographics) → what it means
import { useMemo, useState } from 'react'
import { getMetricIntel, getOverview, getTrends, useApi } from '../api'
import { colors, semantics, alpha } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import TrendLine from '../components/charts/TrendLine'
import SentimentArea from '../components/charts/SentimentArea'
import PriorityDistribution from '../components/charts/PriorityDistribution'
import EntityBar from '../components/charts/EntityBar'
import MetricBrief from '../components/metrics/MetricBrief'
import {
  AnomalyPanel,
  CategoryPanel,
  DriftPanel,
  HotTopicsPanel,
  MoversPanel,
  VolumeShapePanel,
} from '../components/metrics/panels'
import { METRICS, metricMeta, pct, signedPct, shortDate } from '../components/metrics/vocab'

const WINDOWS = [7, 30, 90]

const INFO_KEY = {
  volume: 'trendVolume',
  sentiment: 'trendSentiment',
  priority: 'trendPriority',
  entity: 'trendEntity',
}

const HEALTH_COLOR = {
  healthy: semantics.run.done,
  degraded: semantics.run.failed,
  running: semantics.run.running,
}

/** The four numbers that lead the page, per metric.
 *
 *  Chosen so each one can change what a reader does next — not four views of
 *  the same total. Values come from the intel payload; nothing is recomputed
 *  here, so the headline can never disagree with the panels below it. */
function headlineStats(metric, intel) {
  if (!intel) return []

  if (metric === 'volume') {
    return [
      { label: 'Posts', value: Math.round(intel.total).toLocaleString(), sub: `${intel.dailyAvg}/day` },
      {
        label: 'Vs first half',
        value: intel.change === null ? '—' : signedPct(intel.change),
        sub: intel.change === null ? 'no baseline' : `${intel.firstHalfRate} → ${intel.secondHalfRate}/day`,
        tone: intel.change === null ? null : intel.change >= 0 ? 'good' : 'bad',
      },
      { label: 'Active authors', value: intel.activeAuthors.toLocaleString(), sub: 'distinct' },
      {
        label: 'Quiet days',
        value: intel.quietDays,
        sub: intel.quietDays ? 'no posts at all' : 'posted every day',
        tone: intel.quietDays > intel.window.days / 3 ? 'bad' : null,
      },
    ]
  }

  if (metric === 'sentiment' || metric === 'priority') {
    const watchKey = metric === 'sentiment' ? 'neg' : 'high'
    const watchLabel = metric === 'sentiment' ? 'Negative' : 'High priority'
    const drift = intel.drift?.[watchKey]
    return [
      {
        label: `${watchLabel} share`,
        value: pct(intel.shares[watchKey]),
        sub: `${Math.round(intel.totals[watchKey]).toLocaleString()} posts`,
        tone: intel.shares[watchKey] > 0.3 ? 'bad' : null,
      },
      {
        label: 'Mix shift',
        value: drift ? signedPct(drift.delta, 1) : '—',
        sub: drift ? `${pct(drift.before)} → ${pct(drift.after)}` : 'no baseline',
        tone: drift ? (drift.delta > 0.02 ? 'bad' : drift.delta < -0.02 ? 'good' : null) : null,
      },
      { label: 'Labelled posts', value: intel.labelledPosts.toLocaleString(), sub: 'in window' },
      {
        label: 'Model confidence',
        value: pct(intel.avgConfidence),
        sub: 'average on this slice',
        tone: intel.avgConfidence < 0.6 ? 'bad' : null,
      },
    ]
  }

  const top = intel.top?.[0]
  return [
    { label: 'Mentions', value: Math.round(intel.totalMentions).toLocaleString(), sub: 'entity references' },
    { label: 'Distinct entities', value: intel.distinctEntities.toLocaleString(), sub: 'unique' },
    { label: 'Most mentioned', value: top?.label ?? '—', sub: top ? `${Math.round(top.count)} posts` : '' },
    { label: 'Product share', value: pct(intel.productShare), sub: 'name a Neutrinos product' },
  ]
}

function StatCard({ stat }) {
  const tone =
    stat.tone === 'bad' ? colors.salmon : stat.tone === 'good' ? colors.mint : undefined
  return (
    <div className="rounded-xl border border-hairline p-3.5">
      <p className="text-caption font-light text-muted">{stat.label}</p>
      <p
        className="mt-1 truncate text-h4 font-semibold tabular-nums"
        style={tone ? { color: tone } : undefined}
        title={String(stat.value)}
      >
        {stat.value}
      </p>
      {stat.sub ? <p className="mt-0.5 truncate text-caption text-muted">{stat.sub}</p> : null}
    </div>
  )
}

export default function MetricsExplorer() {
  const page = usePageChoreo([])
  const [metric, setMetric] = useState('volume')
  const [days, setDays] = useState(30)

  // The chart keeps its original data source — it already worked, and the
  // chart components expect that shape.
  const { data, loading } = useApi(() => getTrends(metric, days), { deps: [metric, days] })
  const { data: ov } = useApi(getOverview)
  // The intelligence layer is a separate call: it measures things the trend
  // rows cannot express (anomaly scores, change point, movers, drift).
  const { data: intel, loading: intelLoading } = useApi(() => getMetricIntel(metric, days), {
    deps: [metric, days],
  })

  const meta = metricMeta(metric)

  // `intel` lags a tab change by one render: `metric` flips instantly, the
  // fetch resolves later. Reading last tab's payload with this tab's keys is
  // how `shares.neg` came back undefined — so treat a mismatched payload as
  // "not loaded yet" rather than defending against it at every access site.
  const intelReady = intel?.metric === metric ? intel : null

  const pill = (isActive) =>
    `rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
      isActive ? 'bg-blue text-white' : 'bg-surface text-black/70 hover:text-blue'
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

  const stats = headlineStats(metric, intelReady)

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Metrics explorer</h1>
            <MetricInfo metricKey="metricsPage" />
          </div>
          <p className="mt-1 font-light text-muted">{meta.question}</p>
        </div>
        <div className="flex items-center gap-2">
          {intelReady?.window?.end ? (
            <span className="text-caption text-muted">
              through {shortDate(intelReady.window.end)}
            </span>
          ) : null}
          {ov && (
            <PillTag color={HEALTH_COLOR[ov.pipelineHealth] ?? semantics.run.pending} dot>
              Pipeline {ov.pipelineHealth}
            </PillTag>
          )}
        </div>
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

      {/* Headline numbers: the four facts that change what you do next. */}
      <div data-anim="row" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {intelLoading && !intelReady
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-hairline p-3.5">
                <div className="shimmer h-3 w-1/2 rounded-sm" />
                <div className="shimmer mt-2 h-6 w-2/3 rounded-sm" />
              </div>
            ))
          : stats.map((s) => <StatCard key={s.label} stat={s} />)}
      </div>

      <div data-anim="chart">
        <FrameCard
          title={`${meta.label} — last ${days} days`}
          accent={colors.celeste}
          lift={false}
          infoKey={INFO_KEY[metric]}
        >
          {metric === 'volume' && <TrendLine data={data} loading={loading} />}
          {metric === 'sentiment' && <SentimentArea data={data} loading={loading} />}
          {metric === 'priority' && <PriorityDistribution data={priorityData} loading={loading} />}
          {metric === 'entity' && <EntityBar data={entityData} loading={loading} />}

          {/* Anomaly dates called out under the chart, so a spike in the line
              has a name and a score rather than being left to the eye. */}
          {intelReady?.anomalies?.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <span className="text-caption text-muted">Flagged days:</span>
              {intelReady.anomalies.slice(0, 4).map((a) => (
                <span
                  key={a.date}
                  className="rounded-pill px-2 py-0.5 text-caption font-medium"
                  style={{
                    backgroundColor: alpha(
                      a.direction === 'spike' ? colors.salmon : colors.blue,
                      0.12,
                    ),
                    color: a.direction === 'spike' ? colors.salmon : colors.blue,
                  }}
                >
                  {a.direction === 'spike' ? '↑' : '↓'} {shortDate(a.date)}
                </span>
              ))}
            </div>
          ) : null}
        </FrameCard>
      </div>

      {/* What changed — measured, per metric. */}
      {intelLoading && !intelReady ? (
        <div className="grid gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-5">
              <div className="shimmer h-4 w-1/3 rounded-sm" />
              <div className="shimmer mt-4 h-24 w-full rounded-sm" />
            </div>
          ))}
        </div>
      ) : intelReady ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div data-anim="chart" className="min-w-0 space-y-6 lg:col-span-2">
            {metric === 'volume' ? <VolumeShapePanel intel={intelReady} /> : null}
            {metric === 'sentiment' || metric === 'priority' ? (
              <DriftPanel intel={intelReady} />
            ) : null}
            {metric === 'priority' ? <HotTopicsPanel intel={intelReady} /> : null}
            {metric === 'entity' ? (
              <>
                <MoversPanel intel={intelReady} />
                <CategoryPanel intel={intelReady} />
              </>
            ) : null}
            <AnomalyPanel intel={intelReady} />
          </div>

          {/* What it means — the consultant's read, on demand. */}
          <div data-anim="chart" className="lg:sticky lg:top-6 lg:self-start">
            <MetricBrief metric={metric} days={days} intel={intelReady} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

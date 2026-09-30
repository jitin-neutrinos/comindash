import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Lightbulb, BarChart2, Brain, ChevronDown, ChevronRight, Database, Gauge, RefreshCw, Search, Server } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'

import { getApi, useApi } from '../api'
import { colors, semantics, chart } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import PillTag from '../components/PillTag'
import MetricCard from '../components/MetricCard'
import MetricInfo from '../components/MetricInfo'
import { BrandTooltip, ChartEmpty, axisProps, useChartAnimation } from '../components/charts/chartKit'
import { ListSkeleton, ChartSkeleton, TableSkeleton } from '../components/Skeletons'
import CommandCentre from '../components/admin/CommandCentre'
import Review from './Review'
import InsightRuns from '../components/admin/InsightRuns'

// Tab order is the order an operator actually asks questions in: "is it up?"
// (command centre) → "is the AI any good?" (review) → the raw evidence
// underneath (logs, metrics, history, audit).
const TABS = [
  { id: 'status', label: 'Command centre', icon: Gauge },
  { id: 'review', label: 'Model review', icon: Brain },
  { id: 'logs', label: 'System logs', icon: Server },
  { id: 'metrics', label: 'Metrics', icon: BarChart2 },
  { id: 'pipeline', label: 'Pipeline history', icon: Activity },
  { id: 'insights', label: 'Insight runs', icon: Lightbulb },
  { id: 'audit', label: 'Audit log', icon: Database },
]

/** Deep-linkable tab state, kept in the URL hash.
 *
 *  Why the hash and not component state alone: the review tab is the page a
 *  reader gets pointed at ("look at the model review"), and a bare /admin link
 *  that always lands on the command centre makes that impossible to share. */
function useHashTab(fallback) {
  const valid = TABS.map((t) => t.id)
  const read = () => {
    const h = window.location.hash.replace(/^#/, '')
    return valid.includes(h) ? h : fallback
  }
  const [tab, setTab] = useState(read)
  useEffect(() => {
    const onHash = () => setTab(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const select = (id) => {
    setTab(id)
    // replaceState, not location.hash =: assigning to the hash pushes a history
    // entry per tab click, so Back would walk the tab trail instead of leaving.
    window.history.replaceState(null, '', `#${id}`)
  }
  return [tab, select]
}

/** Log-level → brand color. Semantic state indicators, same treatment as the
 * status pills used everywhere else (semantics.run / semantics.priority). */
const LEVEL_META = {
  error: { label: 'Error', color: colors.salmon },
  warning: { label: 'Warn', color: colors.iris },
  warn: { label: 'Warn', color: colors.iris },
  info: { label: 'Info', color: colors.blue },
  debug: { label: 'Debug', color: semantics.run.pending },
}

export default function Admin() {
  const root = usePageChoreo([])
  const [activeTab, setActiveTab] = useHashTab('status')

  const tabClass = (active) =>
    `flex items-center gap-2 rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
      active ? 'bg-blue text-white' : 'bg-surface text-black/70 hover:text-blue'
    }`

  return (
    <div ref={root} className="space-y-8">
      <header data-anim="header">
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Command centre</h1>
          <MetricInfo metricKey="adminPage" />
        </div>
        <p className="mt-1 max-w-3xl font-light text-muted">
          The health of everything behind this dashboard in one place: whether each part is up, how
          work moves from raw forum posts to finished insights, how the AI models are performing,
          and the logs and audit trail underneath.
        </p>
      </header>

      <div data-anim="row" className="flex flex-wrap gap-2" role="tablist" aria-label="Admin section">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={tabClass(activeTab === tab.id)}
          >
            <tab.icon size={15} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>

      <div data-anim="chart">
        {activeTab === 'status' && <CommandCentre />}
        {activeTab === 'review' && <Review embedded />}
        {activeTab === 'logs' && <SystemLogs />}
        {activeTab === 'metrics' && <MetricsDashboard />}
        {activeTab === 'pipeline' && <PipelineHistory />}
        {activeTab === 'insights' && <InsightRuns />}
        {activeTab === 'audit' && <AuditLogs />}
      </div>
    </div>
  )
}

function SystemLogs() {
  const [service, setService] = useState('')
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(new Set())

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ limit: 100 })
      if (service) q.set('service', service)
      if (level) q.set('level', level)
      const data = await getApi(`/admin/logs?${q.toString()}`)

      let filtered = data.items || []
      if (search) {
        const lowerSearch = search.toLowerCase()
        filtered = filtered.filter((l) => JSON.stringify(l).toLowerCase().includes(lowerSearch))
      }
      setLogs(filtered)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
    const interval = setInterval(fetchLogs, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, level, search])

  const toggleExpand = (idx) => {
    const next = new Set(expanded)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setExpanded(next)
  }

  return (
    <FrameCard title="System logs" lift={false} infoKey="adminLogs">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="rounded-pill border border-line bg-surface px-4 py-1.5 text-small font-light focus:border-blue focus:outline-none"
        >
          <option value="">All services</option>
          <option value="backend">Backend API</option>
          <option value="worker">Background worker</option>
        </select>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="rounded-pill border border-line bg-surface px-4 py-1.5 text-small font-light focus:border-blue focus:outline-none"
        >
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            type="search"
            placeholder="Search logs"
            aria-label="Search logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-pill border border-line bg-surface py-1.5 pl-9 pr-4 text-small font-light focus:border-blue focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={fetchLogs}
          disabled={loading}
          aria-label="Refresh logs"
          className="rounded-pill border border-line bg-surface p-2 text-muted transition-colors hover:text-blue disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4">
        {loading && !logs.length ? (
          <ListSkeleton rows={5} />
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <PillTag>No logs found</PillTag>
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {logs.map((log, i) => {
              const isExpanded = expanded.has(i)
              if (log._raw) {
                return (
                  <div key={i} className="py-2 font-mono text-caption text-muted">
                    {log._raw}
                  </div>
                )
              }
              const lvl = (log.level || 'info').toLowerCase()
              const meta = LEVEL_META[lvl] ?? { label: log.level || 'Info', color: semantics.run.pending }
              const msg = log.event || log.msg || ''
              const ts = log.timestamp || log.ts
              return (
                <div key={i} className="py-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    aria-expanded={isExpanded}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="mt-1 shrink-0 text-muted" aria-hidden="true" />
                    ) : (
                      <ChevronRight size={14} className="mt-1 shrink-0 text-muted" aria-hidden="true" />
                    )}
                    <span className="w-40 shrink-0 font-mono text-caption text-muted">
                      {ts ? new Date(ts).toISOString() : ''}
                    </span>
                    <PillTag color={meta.color} dot className="shrink-0">
                      {meta.label}
                    </PillTag>
                    <span className="w-24 shrink-0 truncate text-caption text-muted">
                      {log.logger || log.service || 'app'}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-small">{msg}</span>
                    {log.request_id && (
                      <span className="shrink-0 font-mono text-caption text-muted">
                        {log.request_id.split('-')[0]}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <pre className="ml-7 mt-2 overflow-x-auto rounded-lg bg-mist p-3 font-mono text-caption text-muted">
                      {JSON.stringify(log, null, 2)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </FrameCard>
  )
}

function MetricsDashboard() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const animated = useChartAnimation()

  useEffect(() => {
    let cancelled = false
    async function fetchMetrics() {
      try {
        const end = Math.floor(Date.now() / 1000)
        const start = end - 30 * 60
        const step = '60s'

        const [q1, q2] = await Promise.all([
          getApi(
            `/admin/metrics/query_range?query=${encodeURIComponent('sum(rate(http_requests_total[5m]))')}&start=${start}&end=${end}&step=${step}`,
          ),
          getApi(
            `/admin/metrics/query_range?query=${encodeURIComponent('sum(rate(http_requests_total{status=~"5.."}[5m]))')}&start=${start}&end=${end}&step=${step}`,
          ),
        ])

        const toPoints = (res) =>
          (res.data?.result?.[0]?.values ?? []).map(([t, v]) => ({ time: new Date(t * 1000), value: parseFloat(v) }))
        const d1 = toPoints(q1)
        const d2 = toPoints(q2)
        const merged = d1.map((p, i) => ({
          time: format(p.time, 'HH:mm'),
          requests: p.value,
          errors: d2[i]?.value ?? 0,
        }))
        if (!cancelled) setSeries(merged)
      } catch (e) {
        console.error(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMetrics()
    const id = setInterval(fetchMetrics, 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const last = series[series.length - 1]

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <FrameCard title="API request rate" lift={false} infoKey="adminApiRate" className="lg:col-span-2">
        {loading ? (
          <ChartSkeleton height={260} />
        ) : series.length ? (
          <div style={{ height: 260 }} role="img" aria-label="API request and error rate over the last 30 minutes">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis dataKey="time" stroke={chart.axis} {...axisProps()} />
                <YAxis stroke={chart.axis} allowDecimals={false} {...axisProps()} />
                <Tooltip content={<BrandTooltip formatter={(v) => v.toFixed(2)} />} cursor={{ stroke: chart.grid }} />
                <Line
                  type="monotone"
                  dataKey="requests"
                  name="Requests/s"
                  stroke={chart.primary}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={animated}
                />
                <Line
                  type="monotone"
                  dataKey="errors"
                  name="Errors/s"
                  stroke={colors.salmon}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={animated}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <ChartEmpty height={260} />
        )}
      </FrameCard>

      <div className="grid gap-6">
        <MetricCard
          label="Traffic (5m)"
          value={last?.requests ?? 0}
          format={(v) => `${v.toFixed(2)} req/s`}
          hint="Requests per second, averaged over 5 minutes"
          infoKey="adminTraffic"
        />
        <MetricCard
          label="Error rate (5m)"
          value={last?.errors ?? 0}
          format={(v) => `${v.toFixed(2)} err/s`}
          accent={colors.salmon}
          hint="Server failures per second"
          infoKey="adminErrorRate"
        />
      </div>
    </div>
  )
}

function PipelineHistory() {
  const { data, loading } = useApi(() => getApi('/admin/pipeline?limit=50'), { intervalMs: 15000 })
  const items = data?.items ?? []

  return (
    <FrameCard title="Pipeline history" lift={false} infoKey="adminPipeline">
      {loading && !data ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <PillTag>No runs yet</PillTag>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-small">
            <thead>
              <tr className="text-caption font-medium uppercase tracking-wider text-muted">
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Trigger</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => (
                <tr key={run.id} className="border-t border-hairline">
                  <td className="py-2.5 pr-4 font-medium capitalize">{run.kind}</td>
                  <td className="py-2.5 pr-4">
                    <PillTag color={semantics.run[run.status] ?? semantics.run.pending} dot>
                      {run.status}
                    </PillTag>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-caption text-muted">{run.triggered_by || '—'}</td>
                  <td className="py-2.5 pr-4 font-light text-muted">
                    {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-2.5 font-light text-muted">
                    {run.started_at && run.finished_at
                      ? `${((new Date(run.finished_at) - new Date(run.started_at)) / 1000).toFixed(1)}s`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FrameCard>
  )
}

function AuditLogs() {
  const { data, loading } = useApi(() => getApi('/admin/audit?limit=100'))
  const items = data?.items ?? []

  return (
    <FrameCard title="Audit log" lift={false} infoKey="adminAudit">
      <div className="mb-4 flex items-start gap-2 rounded-xl bg-mist px-4 py-3 text-small font-light text-muted">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-blue" aria-hidden="true" />
        <p>
          This is the security trail: who changed a setting, who started a job by hand. Day-to-day
          activity lives in System logs.
        </p>
      </div>
      {loading && !data ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <PillTag>No security events recorded yet</PillTag>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-small">
            <thead>
              <tr className="text-caption font-medium uppercase tracking-wider text-muted">
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2">Target / detail</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id} className="border-t border-hairline align-top">
                  <td className="whitespace-nowrap py-2.5 pr-4 font-light text-muted">
                    {new Date(log.ts).toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 font-medium">{log.actor}</td>
                  <td className="py-2.5 pr-4 text-blue">{log.action}</td>
                  <td className="max-w-[420px] break-words py-2.5 font-mono text-caption text-muted">
                    {log.target && <span className="mr-2 font-sans text-caption font-medium text-black">{log.target}</span>}
                    {JSON.stringify(log.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FrameCard>
  )
}

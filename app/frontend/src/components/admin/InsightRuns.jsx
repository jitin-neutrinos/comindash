import React, { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { getInsightRuns, getInsightRun } from '../../api'
import { useApi } from '../../api'
import { semantics } from '../../theme'
import FrameCard from '../FrameCard'
import PillTag from '../PillTag'
import Pagination from '../Pagination'
import { TableSkeleton, ListSkeleton } from '../Skeletons'

function formatDuration(ms) {
  if (!ms) return '—'
  const secs = ms / 1000
  if (secs >= 60) {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}m ${s}s`
  }
  return `${secs.toFixed(1)}s`
}

// Map insight type to label
const insightTypeLabels = {
  pain_point: 'Pain point',
  trend: 'Trend',
  anomaly: 'Anomaly',
  relationship: 'Relationship',
  recommendation: 'Recommendation',
}

function InsightRunRow({ run }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    setExpanded(!expanded)
    if (!expanded && !detail && !loading) {
      setLoading(true)
      try {
        const data = await getInsightRun(run.id)
        setDetail(data)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
  }

  const costLabel = run.costUsd === null || run.costUsd === undefined ? '—' : `$${run.costUsd.toFixed(4)}`

  return (
    <>
      <tr className="border-t border-hairline align-top cursor-pointer hover:bg-mist/50" onClick={toggle}>
        <td className="py-2.5 pr-2 w-6">
          <button className="text-muted" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="py-2.5 pr-4 whitespace-nowrap font-light text-muted">
          {run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
        </td>
        <td className="py-2.5 pr-4">
          <PillTag color={semantics.run[run.status] ?? semantics.run.pending} dot>
            {run.status}
          </PillTag>
        </td>
        <td className="py-2.5 pr-4 font-medium max-w-[150px] truncate" title={run.model}>{run.model || '—'}</td>
        <td className="py-2.5 pr-4 text-right">{run.postsCovered.toLocaleString()}</td>
        <td className="py-2.5 pr-4 text-right">{run.tokens.toLocaleString()}</td>
        <td className="py-2.5 pr-4 text-right font-mono text-caption">{costLabel}</td>
        <td className="py-2.5 pr-4 font-light text-muted text-right">{formatDuration(run.durationMs)}</td>
        <td className="py-2.5 text-right font-medium">
          <span>{run.accepted}</span>
          <span className="text-muted mx-1">/</span>
          <span className={run.rejected > 0 ? "text-salmon" : "text-muted"}>{run.rejected}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t-0 border-b border-hairline bg-mist/20">
          <td colSpan={9} className="py-4 pl-8 pr-4">
            {run.error && (
              <div className="mb-4">
                <PillTag color={semantics.run.failed}>Error</PillTag>
                <div className="mt-2 text-small text-salmon font-mono break-all">{run.error}</div>
              </div>
            )}
            {loading ? (
              <ListSkeleton rows={4} />
            ) : detail && detail.insights.length > 0 ? (
              <div className="space-y-3">
                {detail.insights.map((ins) => (
                  <div key={ins.id} className="flex gap-4 items-start text-small">
                    <div className="w-[120px] shrink-0 text-muted">
                      {insightTypeLabels[ins.type] || ins.type}
                    </div>
                    <div className="w-[80px] shrink-0">
                      <PillTag color={semantics.priority[ins.severity] ?? semantics.priority.low}>{ins.severity}</PillTag>
                    </div>
                    <div className="min-w-0 flex-1 break-words font-medium">{ins.title}</div>
                    <div className="w-[100px] shrink-0 text-right text-caption text-muted">
                      {new Date(ins.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : detail && detail.insights.length === 0 ? (
              <div className="text-small text-muted italic">No insights generated in this run.</div>
            ) : null}
          </td>
        </tr>
      )}
    </>
  )
}

export default function InsightRuns() {
  const [page, setPage] = useState(1)
  const per = 15
  const { data, loading, error } = useApi(() => getInsightRuns(page, per), {
    deps: [page],
    intervalMs: 15000,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <FrameCard title="Insight runs" lift={false} infoKey="adminInsightRuns">
      <p className="mb-6 text-small text-muted font-light max-w-3xl">
        Each run replaces the previous set — the dashboard always shows one coherent set of insights.
      </p>

      {error ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <PillTag color={semantics.run.failed}>Error</PillTag>
          <p className="text-small text-salmon">{error.message || 'Failed to load insight runs'}</p>
        </div>
      ) : loading && !data ? (
        <TableSkeleton />
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <PillTag>No insight runs yet</PillTag>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-small">
              <thead>
                <tr className="text-caption font-medium uppercase tracking-wider text-muted">
                  <th className="py-2 pr-2 w-6"></th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4 text-right">Posts covered</th>
                  <th className="py-2 pr-4 text-right">Tokens</th>
                  <th className="py-2 pr-4 text-right">Estimated cost</th>
                  <th className="py-2 pr-4 text-right">Duration</th>
                  <th className="py-2 text-right">Accepted / Rejected</th>
                </tr>
              </thead>
              <tbody>
                {items.map((run) => (
                  <InsightRunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
          {total > per && (
            <div className="mt-6 border-t border-hairline pt-4">
              <Pagination total={total} per={per} page={page} setPage={setPage} />
            </div>
          )}
        </>
      )}
    </FrameCard>
  )
}

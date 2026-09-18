import { useRef } from 'react'
import { getHealth, relTime, useApi } from '../api'
import { semantics } from '../theme'
import { usePulseAll } from '../motion'
import { Skeleton } from './Skeletons'

const KINDS = [
  { kind: 'ingest', label: 'Ingestion' },
  { kind: 'analyze', label: 'Analysis' },
  { kind: 'assistant', label: 'Assistant' },
]

/**
 * Ingestion / analysis / assistant stage health, from /api/health (dark rail
 * variant). Dots pulse only while a stage is running or failed — paused
 * (static) when healthy.
 *
 * `compact`: icon-rail form — just the three status dots, stacked, each with
 * a title tooltip. Used by the always-narrow Sidebar, which has no room for
 * the labelled list below.
 */
export default function PipelineHealthStrip({ className = '', compact = false }) {
  const { data, loading } = useApi(getHealth, { intervalMs: 60000 })
  const root = useRef(null)

  usePulseAll(root, '[data-pulse]', [data, loading])

  const runFor = (kind) => data?.lastRun?.[kind] ?? {}

  if (compact) {
    if (loading && !data) {
      return (
        <div className={`flex flex-col items-center gap-2 ${className}`} aria-hidden="true">
          {KINDS.map(({ kind }) => (
            <Skeleton key={kind} className="h-2 w-2 rounded-full" />
          ))}
        </div>
      )
    }
    return (
      <div ref={root} className={`flex flex-col items-center gap-2 ${className}`} aria-label="Pipeline health">
        {KINDS.map(({ kind, label }) => {
          const run = runFor(kind)
          const status = (run.stats?.mode === 'skipped' || run.triggered_by?.includes('skipped')) ? 'skipped' : (run.status ?? 'pending')
          const color = semantics.run[status] ?? semantics.run.pending
          const attention = status === 'running' || status === 'failed'
          return (
            <span
              key={kind}
              aria-hidden="true"
              data-pulse={attention ? 'true' : undefined}
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              title={`${label}: ${run.finished_at ? relTime(run.finished_at) : status}`}
            />
          )
        })}
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className={`space-y-2 ${className}`} aria-hidden="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  return (
    <div ref={root} className={className}>
      <p className="mb-2 text-caption font-medium uppercase tracking-wider text-white/45">Pipeline</p>
      <ul className="space-y-1.5">
        {KINDS.map(({ kind, label }) => {
          const run = runFor(kind)
          const status = (run.stats?.mode === 'skipped' || run.triggered_by?.includes('skipped')) ? 'skipped' : (run.status ?? 'pending')
          const color = semantics.run[status] ?? semantics.run.pending
          const attention = status === 'running' || status === 'failed'
          return (
            <li key={kind} className="flex items-center justify-between gap-2 text-caption">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  data-pulse={attention ? 'true' : undefined}
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate font-medium text-white/80">{label}</span>
              </span>
              <span className="shrink-0 font-light text-white/55" title={status}>
                {run.finished_at ? relTime(run.finished_at) : status}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

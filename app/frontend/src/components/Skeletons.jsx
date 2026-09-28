/** Loading placeholders — pure-CSS shimmer blocks (see .shimmer in index.css).
 *  Every skeleton mirrors the real layout it stands in for, so pages keep
 *  their shape while data loads. */
import { colors, alpha } from '../theme'

export function Skeleton({ className = '', style }) {
  return <div aria-hidden="true" style={style} className={`shimmer rounded-md ${className}`} />
}

/* KPI card — mirrors MetricCard: tinted bezel + white plate + label/value/hint. */
export function MetricSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-full"
      style={{
        borderRadius: 18,
        padding: 4,
        background: `linear-gradient(160deg, ${alpha(colors.blue, 0.13)}, ${alpha(colors.black, 0.045)} 62%)`,
        boxShadow: `0 1px 2px ${alpha(colors.black, 0.04)}, 0 12px 32px -18px ${alpha(colors.black, 0.14)}`,
      }}
    >
      <div className="rounded-xl bg-surface p-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-10 w-20" />
        <Skeleton className="mt-3 h-2.5 w-16" />
      </div>
    </div>
  )
}

/* Vertical bars — line/area charts (volume, sentiment, admin rate). */
export function ChartSkeleton({ height = 280 }) {
  return (
    <div role="status" aria-label="Loading chart" style={{ height }} className="w-full">
      <div className="flex h-full items-end gap-2 px-1 pt-4">
        {[55, 80, 40, 65, 90, 50, 75, 60, 85, 45, 70, 58].map((h, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

/* Donut/ring — priority mix + severity ring. */
export function DonutSkeleton({ height = 280 }) {
  return (
    <div role="status" aria-label="Loading chart" style={{ height }} className="flex w-full items-center justify-center">
      <div className="relative" style={{ height: Math.round(height * 0.6), width: Math.round(height * 0.6) }}>
        <div className="shimmer absolute inset-0 rounded-full" />
        <div className="absolute inset-6 rounded-full bg-surface" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-2.5 w-10" />
        </div>
      </div>
    </div>
  )
}

/* Horizontal bars — entity leaderboard rows (label track + value). */
export function HBarsSkeleton({ height = 280, rows = 5 }) {
  return (
    <div role="status" aria-label="Loading chart" style={{ height }} className="flex w-full flex-col justify-center gap-4 px-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 shrink-0" style={{ width: `${16 + (i % 3) * 3}%` }} />
          <Skeleton className="h-5 flex-1" style={{ maxWidth: `${75 - i * 11}%` }} />
        </div>
      ))}
    </div>
  )
}

/* Network map — Relationships page: scattered nodes + hairline edges. */
const GRAPH_NODES = [
  [12, 18, 26], [30, 8, 18], [48, 22, 30], [68, 12, 20], [84, 26, 24],
  [20, 48, 22], [42, 55, 32], [64, 46, 18], [82, 58, 26], [14, 78, 20],
  [38, 84, 24], [60, 76, 20], [80, 84, 28],
]
const GRAPH_EDGES = [
  [13, 26, 24, 14, -14], [31, 47, 49, 22, 22], [49, 66, 46, 13, -18],
  [22, 39, 57, 47, 52], [44, 63, 55, 46, -8], [42, 59, 84, 76, 40],
]
export function GraphSkeleton({ height = 620 }) {
  return (
    <div role="status" aria-label="Loading graph" style={{ height }} className="relative w-full overflow-hidden">
      {GRAPH_EDGES.map(([x1, x2, y1, y2], i) => {
        const dx = x2 - x1, dy = y2 - y1
        const len = Math.sqrt(dx * dx + dy * dy)
        return (
          <div
            key={i}
            className="shimmer absolute origin-left rounded-full opacity-60"
            style={{
              left: `${x1}%`, top: `${y1}%`, width: `${len * 0.62}%`, height: 1.5,
              transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`,
            }}
          />
        )
      })}
      {GRAPH_NODES.map(([x, y, d], i) => (
        <div key={`n${i}`} className="shimmer absolute rounded-full" style={{ left: `${x}%`, top: `${y}%`, width: d, height: d }} />
      ))}
    </div>
  )
}

/* Insight list row — mirrors InsightRow: pills, title, stats, sparkline, subjects. */
export function InsightRowSkeleton({ variant = 0, compact = false }) {
  const w = ['w-3/4', 'w-2/3', 'w-4/5', 'w-1/2'][variant % 4]
  return (
    <div aria-hidden="true" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className="h-5 w-14 rounded-pill" />
        <Skeleton className="h-5 w-12 rounded-pill" />
        <Skeleton className="ml-auto h-3 w-24" />
      </div>
      <Skeleton className={`mt-3 h-4 ${w}`} />
      {!compact && (
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
          <Skeleton className="hidden h-9 w-40 shrink-0 sm:block" />
        </div>
      )}
      {!compact && (
        <div className="mt-4 flex items-center gap-1.5 border-t border-hairline pt-3">
          <Skeleton className="h-4 w-14 rounded-pill" />
          <Skeleton className="h-4 w-16 rounded-pill" />
          <Skeleton className="h-4 w-12 rounded-pill" />
        </div>
      )}
    </div>
  )
}

/* Data Explorer rows — title + date, excerpt, matching PostRow/TopicRow. */
export function RowsSkeleton({ rows = 6 }) {
  return (
    <div aria-hidden="true" className="divide-y divide-hairline">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between gap-3">
            <Skeleton className={`h-4 ${['w-2/3', 'w-1/2', 'w-3/4'][i % 3]}`} />
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
          <Skeleton className={`mt-2 h-3 ${i % 2 ? 'w-11/12' : 'w-full'}`} />
        </div>
      ))}
    </div>
  )
}

/* Insight detail — back link, pills, big title, paragraph, brief panel. */
export function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-pill" />
          <Skeleton className="h-6 w-24 rounded-pill" />
          <Skeleton className="h-6 w-16 rounded-pill" />
        </div>
        <Skeleton className="h-9 w-3/4 max-w-2xl" />
      </div>
      <div className="space-y-3 rounded-xl border border-line bg-surface p-6">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  )
}

/* Generic text list — admin logs and any simple stacked-lines surface. */
export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-line bg-surface p-6">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 8 }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading table">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

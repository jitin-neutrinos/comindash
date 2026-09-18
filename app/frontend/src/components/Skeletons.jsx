/** Loading placeholders — pure-CSS shimmer blocks (see .shimmer in index.css). */

export function Skeleton({ className = '', style }) {
  return <div aria-hidden="true" style={style} className={`shimmer rounded-md ${className}`} />
}

export function MetricSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-white p-6" style={{ borderLeft: '2px solid transparent' }}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-10 w-20" />
    </div>
  )
}

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

export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-line bg-white p-6">
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

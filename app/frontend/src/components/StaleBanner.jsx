import { useMemo, useRef, useState } from 'react'
import { getHealth, useApi } from '../api'
import { alpha, colors } from '../theme'
import { usePulse } from '../motion'

const STALE_AFTER_MS = 2 * 60 * 60 * 1000 // SPEC: banner when last run > 2h old

/**
 * Dismissible banner shown when /api/health reports a failed pipeline stage
 * or a last run older than 2 hours. Status dot pulses (attention state).
 */
export default function StaleBanner() {
  const { data } = useApi(getHealth, { intervalMs: 60000 })
  const [dismissed, setDismissed] = useState(false)
  const dot = useRef(null)

  const stale = useMemo(() => {
    if (!data) return false
    const runs = Object.values(data.lastRun ?? {})
    if (runs.some((r) => r?.status === 'failed')) return true
    const times = runs
      .map((r) => Date.parse(r?.finished_at ?? r?.started_at ?? ''))
      .filter(Number.isFinite)
    if (!times.length) return false
    return Date.now() - Math.max(...times) > STALE_AFTER_MS
  }, [data])

  usePulse(dot, stale && !dismissed)

  if (!stale || dismissed) return null

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 px-4 py-3 text-small sm:px-6"
      style={{
        borderBottom: `1px solid ${alpha(colors.salmon, 0.25)}`,
        backgroundColor: alpha(colors.salmon, 0.08),
      }}
    >
      <p className="flex items-center gap-2.5 font-normal text-black">
        <span
          ref={dot}
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: colors.salmon }}
        />
        Data may be outdated — pipeline issue being retried.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-pill px-3 py-1 font-medium text-black transition-colors hover:bg-black/5"
      >
        Dismiss
      </button>
    </div>
  )
}

import { useRef } from 'react'
import { alpha, colors } from '../theme'
import { useCountUp } from '../motion'
import MetricInfo from './MetricInfo'
import { DeltaChip } from './Surface'

/**
 * KPI card — white plate on a tinted bezel, GSAP count-up (runs on mount and
 * whenever `value` changes; final value under reduced motion).
 *
 * `delta` is the measured period-over-period move from /api/overview.
 * `polarity` tells the chip whether "up" is good ('normal'), bad ('inverse')
 * or neither ('neutral') — colour must follow meaning, not arithmetic sign.
 */
export default function MetricCard({
  label,
  value = 0,
  format,
  hint,
  accent = colors.blue,
  infoKey,
  delta,
  deltaLabel,
  polarity = 'neutral',
  spark,
}) {
  const numRef = useRef(null)
  useCountUp(numRef, value, format)
  const fmt = format ?? ((v) => Math.round(v).toLocaleString())

  return (
    <article
      className="bezel-lift relative h-full"
      style={{
        borderRadius: 18,
        padding: 4,
        background: `linear-gradient(160deg, ${alpha(accent, 0.13)}, ${alpha(colors.midnight, 0.045)} 62%)`,
        boxShadow: `0 1px 2px ${alpha(colors.midnight, 0.04)}, 0 12px 32px -18px ${alpha(colors.midnight, 0.14)}`,
      }}
    >
      <div
        className="relative flex h-full flex-col bg-white p-5"
        style={{
          borderRadius: 14,
          boxShadow: `inset 0 1px 0 ${alpha(colors.white, 0.9)}, inset 0 0 0 1px ${alpha(colors.midnight, 0.055)}`,
        }}
      >
        <div className="relative flex items-start justify-between gap-2">
          <p className="min-w-0 text-caption font-medium uppercase tracking-wider text-muted">
            {label}
          </p>
          {infoKey && <MetricInfo metricKey={infoKey} accent={accent} />}
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <p
            ref={numRef}
            className="text-h1 font-semibold leading-none tracking-tight tabular-nums"
            aria-label={`${label}: ${fmt(value)}`}
          >
            {fmt(value)}
          </p>
          {spark}
        </div>
        {(delta || hint) && (
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2.5">
            {delta && (
              <DeltaChip delta={delta} polarity={polarity} label={deltaLabel ?? label} />
            )}
            {/* The delta's own window, not the value's caption: "+85%" beside
                "all time" would read as an all-time change, which it is not.
                When a delta measures something other than the headline number,
                say so — `deltaLabel` names what actually moved. */}
            <p className="text-caption font-light text-muted">
              {delta
                ? `${deltaLabel ? `${deltaLabel}, ` : ''}vs prev ${delta.window_days}d`
                : hint}
            </p>
          </div>
        )}
      </div>
    </article>
  )
}

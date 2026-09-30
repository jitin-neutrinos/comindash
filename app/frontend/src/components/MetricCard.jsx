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
  details,
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
        background: `linear-gradient(160deg, ${alpha(accent, 0.13)}, ${alpha(colors.black, 0.045)} 62%)`,
        boxShadow: `0 1px 2px ${alpha(colors.black, 0.04)}, 0 12px 32px -18px ${alpha(colors.black, 0.14)}`,
      }}
    >
      <div
        className="relative flex h-full flex-col bg-surface p-5"
        style={{
          borderRadius: 14,
          boxShadow: `inset 0 1px 0 ${alpha(colors.white, 0.9)}, inset 0 0 0 1px ${alpha(colors.black, 0.055)}`,
        }}
      >
        <div className="relative flex items-start justify-between gap-2">
          <p className="min-w-0 text-caption font-medium uppercase tracking-wider text-muted">
            {label}
          </p>
          {infoKey && <MetricInfo metricKey={infoKey} accent={accent} />}
        </div>
        {/* Value row wraps when tight: the spark drops below the number and
            right-aligns instead of pressing into the card edge. The delta
            row's own mt-auto absorbs leftover tile height, so tall and short
            tiles both read balanced. */}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <p
            ref={numRef}
            className="min-w-0 text-h1 font-semibold leading-none tracking-tight tabular-nums"
            aria-label={`${label}: ${fmt(value)}`}
          >
            {fmt(value)}
          </p>
          {spark && (
            <div className="ml-auto min-w-0 max-w-full [&_svg]:h-auto [&_svg]:max-w-full">
              {spark}
            </div>
          )}
        </div>
        {/* Details region: only renders when the caller supplies content AND
            the tile is wide enough (container query). This is what fills
            landscape/wide tiles — real supporting data instead of empty air.
            Its mt-auto splits leftover tile height with the delta row's, so
            extra space distributes evenly instead of pooling at the bottom. */}
        {details && (
          <div className="@container">
            <div className="hidden @[280px]:mt-auto @[280px]:block @[280px]:border-t @[280px]:border-hairline @[280px]:pt-3">
              {details}
            </div>
          </div>
        )}
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

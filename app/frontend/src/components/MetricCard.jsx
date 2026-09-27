import { useRef } from 'react'
import { colors } from '../theme'
import { useCountUp } from '../motion'
import MetricInfo from './MetricInfo'

/**
 * KPI card — white surface, 1px border, thin 2px accent rule, GSAP count-up
 * (runs on mount and whenever `value` changes; final value under reduced motion).
 */
export default function MetricCard({ label, value = 0, format, hint, accent = colors.blue, infoKey }) {
  const numRef = useRef(null)
  useCountUp(numRef, value, format)
  const fmt = format ?? ((v) => Math.round(v).toLocaleString())

  return (
    <article
      className="card-lift rounded-xl border border-line bg-white p-6"
    >
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 text-caption font-medium uppercase tracking-wider text-muted">{label}</p>
        {infoKey && <MetricInfo metricKey={infoKey} accent={accent} />}
      </div>
      <p
        ref={numRef}
        className="mt-2 text-h1 font-semibold leading-none tracking-tight tabular-nums"
        aria-label={`${label}: ${fmt(value)}`}
      >
        {fmt(value)}
      </p>
      {hint && <p className="mt-2 text-caption font-light text-muted">{hint}</p>}
    </article>
  )
}

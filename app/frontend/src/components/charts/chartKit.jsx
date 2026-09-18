import { chart } from '../../theme'
import { usePrefersReducedMotion } from '../../motion'
import PillTag from '../PillTag'

/** Shared animation flag for Recharts (respects prefers-reduced-motion). */
export function useChartAnimation() {
  return !usePrefersReducedMotion()
}

/** Brand tooltip for Recharts — one consistent style across every chart. */
export function BrandTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 text-small shadow-md">
      {label != null && label !== '' && <p className="mb-1 font-medium">{label}</p>}
      <ul>
        {payload.map((p) => (
          <li key={p.name} className="flex items-center gap-2 font-light">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color || p.fill }}
            />
            <span>
              {p.name}: {formatter ? formatter(p.value) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** SPEC empty state: PillTag "No data yet". */
export function ChartEmpty({ height = 200 }) {
  return (
    <div
      className="flex w-full items-center justify-center py-6"
      style={{ minHeight: height / 2 }}
      role="status"
    >
      <PillTag>No data yet</PillTag>
    </div>
  )
}

/** Common axis props so every chart shares one voice (12px muted text). */
export const axisProps = {
  tick: { fontSize: 12, fill: chart.axis },
  tickLine: false,
}

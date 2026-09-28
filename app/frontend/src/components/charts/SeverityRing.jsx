import { useLayoutEffect, useRef } from 'react'
import { alpha, colors } from '../../theme'
import { gsap } from '../../motion'
import { DonutSkeleton } from '../Skeletons'
import { ChartEmpty } from './chartKit'

/**
 * SVG donut ring. data: [{ label, value, color }]
 * Arcs sweep in via GSAP strokeDashoffset (skipped under reduced motion).
 */
export default function SeverityRing({ data, loading, size = 200, thickness = 18, centerLabel = 'Total' }) {
  const root = useRef(null)
  const rows = (data ?? []).filter((d) => d.value > 0)
  const total = rows.reduce((sum, d) => sum + d.value, 0)

  useLayoutEffect(() => {
    const el = root.current
    if (!el || !total) return undefined
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const arcs = el.querySelectorAll('circle[data-final]')
      const tweens = [...arcs].map((arc, i) => {
        const final = parseFloat(arc.dataset.final)
        const circ = parseFloat(arc.dataset.circ)
        return gsap.fromTo(
          arc,
          { strokeDashoffset: final - circ }, // start one full turn back → sweep in
          { strokeDashoffset: final, duration: 0.9, ease: 'power2.inOut', delay: i * 0.12 },
        )
      })
      // progress(1) before kill so an interrupted sweep lands on the real
      // arc length instead of freezing part-way round.
      return () => tweens.forEach((t) => t.progress(1).kill())
    })
    return () => mm.revert()
  }, [total, data])

  if (loading) return <DonutSkeleton height={size} />
  if (!total) return <ChartEmpty height={size} />

  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div ref={root} className="flex flex-col items-center" role="img" aria-label="Severity mix">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={alpha(colors.midnight, 0.06)}
          strokeWidth={thickness}
        />
        {rows.map((d) => {
          const frac = d.value / total
          const dash = frac * c
          const el = (
            <circle
              key={d.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              data-final={-offset}
              data-circ={c}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${d.label}: ${d.value}`}</title>
            </circle>
          )
          offset += dash
          return el
        })}
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          fontSize={size * 0.16}
          fontWeight={600}
          fill={colors.black}
        >
          {total.toLocaleString()}
        </text>
        <text
          x={size / 2}
          y={size / 2 + size * 0.1}
          textAnchor="middle"
          fontSize={size * 0.066}
          fill={alpha(colors.midnight, 0.6)}
        >
          {centerLabel}
        </text>
      </svg>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {rows.map((d) => (
          <li
            key={d.label}
            className="flex items-center gap-2 rounded-pill px-3 py-1 text-small font-medium"
            style={{ backgroundColor: alpha(d.color, 0.12) }}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            {d.label} {d.value}
          </li>
        ))}
      </ul>
    </div>
  )
}

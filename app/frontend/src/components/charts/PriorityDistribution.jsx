import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { semantics } from '../../theme'
import { ChartSkeleton } from '../Skeletons'
import PillTag from '../PillTag'
import { BrandTooltip, ChartEmpty, useChartAnimation } from './chartKit'

/**
 * Priority mix donut. data: [{ name: 'High'|'Medium'|'Low', value }]
 * Priority is a neutral classification → Neutrinos Blue shade ramp
 * (Salmon is reserved for pain-point severity).
 */
export default function PriorityDistribution({ data, loading, height = 280 }) {
  const animated = useChartAnimation()
  if (loading) return <ChartSkeleton height={height} />
  const rows = (data ?? []).filter((d) => d.value > 0)
  if (!rows.length) return <ChartEmpty height={height} />
  const total = rows.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="w-full" style={{ height }} role="img" aria-label="Priority distribution">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<BrandTooltip formatter={(v) => `${v} posts`} />} />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={animated}
          >
            {rows.map((d) => (
              <Cell key={d.name} fill={semantics.priority[d.name.toLowerCase()] ?? semantics.priority.low} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {rows.map((d) => (
          <PillTag key={d.name} color={semantics.priority[d.name.toLowerCase()]} dot>
            {d.name} {Math.round((d.value / total) * 100)}%
          </PillTag>
        ))}
      </div>
    </div>
  )
}

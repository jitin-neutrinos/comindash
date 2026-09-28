import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { alpha, chart, colors } from '../../theme'
import { HBarsSkeleton } from '../Skeletons'
import { BrandTooltip, ChartEmpty, axisProps, useChartAnimation } from './chartKit'

/** Top-entity frequency bars (horizontal). data: [{ label, count }] */
export default function EntityBar({ data, loading, height }) {
  const animated = useChartAnimation()
  if (loading) return <HBarsSkeleton height={height ?? 280} />
  const rows = data ?? []
  if (!rows.length) return <ChartEmpty height={height ?? 280} />

  const h = height ?? Math.max(200, rows.length * 34 + 24)
  return (
    <div className="w-full" style={{ height: h }} role="img" aria-label="Most mentioned entities">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke={chart.grid} horizontal={false} />
          <XAxis type="number" stroke={chart.axis} allowDecimals={false} {...axisProps} />
          <YAxis
            type="category"
            dataKey="label"
            stroke={chart.axis}
            width={120}
            tick={{ fontSize: 12, fill: chart.axis }}
            tickLine={false}
          />
          <Tooltip content={<BrandTooltip formatter={(v) => `${v} mentions`} />} cursor={{ fill: alpha(colors.midnight, 0.04) }} />
          <Bar
            dataKey="count"
            name="Mentions"
            fill={chart.primary}
            radius={[0, 4, 4, 0]}
            background={{ fill: alpha(colors.midnight, 0.05) }}
            isAnimationActive={animated}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chart } from '../../theme'
import { ChartSkeleton } from '../Skeletons'
import { BrandTooltip, ChartEmpty, axisProps, useChartAnimation } from './chartKit'

/** Post-volume (or any single-series) trend line. data: [{ date, count }] */
export default function TrendLine({ data, loading, height = 280, name = 'Posts' }) {
  const animated = useChartAnimation()
  if (loading) return <ChartSkeleton height={height} />
  if (!data?.length) return <ChartEmpty height={height} />

  return (
    <div className="w-full" style={{ height }} role="img" aria-label={`${name} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={chart.grid} vertical={false} />
          <XAxis dataKey="date" stroke={chart.axis} {...axisProps} />
          <YAxis stroke={chart.axis} allowDecimals={false} {...axisProps} />
          <Tooltip content={<BrandTooltip />} cursor={{ stroke: chart.grid }} />
          <Line
            type="monotone"
            dataKey="count"
            name={name}
            stroke={chart.primary}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={animated}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

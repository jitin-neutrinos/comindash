import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { alpha, chart, colors, semantics } from '../../theme'
import { ChartSkeleton } from '../Skeletons'
import { BrandTooltip, ChartEmpty, axisProps, useChartAnimation } from './chartKit'

const NEU = semantics.sentiment.neu // pre-derived neutral stroke

/**
 * Daily sentiment composition (stacked pos/neu/neg areas, brand accents).
 * Falls back to a single average-sentiment line when only `avg` is present.
 * data: [{ date, pos, neu, neg, avg }]
 */
export default function SentimentArea({ data, loading, height = 280 }) {
  const animated = useChartAnimation()
  if (loading) return <ChartSkeleton height={height} />
  const rows = data ?? []
  const hasCounts = rows.some((d) => d.pos + d.neu + d.neg > 0)
  const hasAvg = rows.some((d) => d.avg !== 0)
  if (!rows.length || (!hasCounts && !hasAvg)) return <ChartEmpty height={height} />

  return (
    <div className="w-full" style={{ height }} role="img" aria-label="Sentiment over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="sentPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={alpha(colors.mint, 0.5)} />
              <stop offset="100%" stopColor={alpha(colors.mint, 0.06)} />
            </linearGradient>
            <linearGradient id="sentNeu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={alpha(colors.midnight, 0.4)} />
              <stop offset="100%" stopColor={alpha(colors.midnight, 0.05)} />
            </linearGradient>
            <linearGradient id="sentNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={alpha(colors.salmon, 0.5)} />
              <stop offset="100%" stopColor={alpha(colors.salmon, 0.06)} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chart.grid} vertical={false} />
          <XAxis dataKey="date" stroke={chart.axis} {...axisProps} />
          <YAxis stroke={chart.axis} allowDecimals={false} {...axisProps} />
          <Tooltip content={<BrandTooltip />} />
          {hasCounts ? (
            <>
              <Area
                type="monotone"
                dataKey="pos"
                name="Positive"
                stackId="sent"
                stroke={semantics.sentiment.pos}
                fill="url(#sentPos)"
                isAnimationActive={animated}
              />
              <Area
                type="monotone"
                dataKey="neu"
                name="Neutral"
                stackId="sent"
                stroke={NEU}
                fill="url(#sentNeu)"
                isAnimationActive={animated}
              />
              <Area
                type="monotone"
                dataKey="neg"
                name="Negative"
                stackId="sent"
                stroke={semantics.sentiment.neg}
                fill="url(#sentNeg)"
                isAnimationActive={animated}
              />
            </>
          ) : (
            <Line
              type="monotone"
              dataKey="avg"
              name="Avg sentiment"
              stroke={chart.primary}
              strokeWidth={2}
              dot={false}
              isAnimationActive={animated}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

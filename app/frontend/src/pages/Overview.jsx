import { Link } from 'react-router-dom'
import { getOverview, getPainPoints, getTrends, useApi } from '../api'
import { colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import MetricCard from '../components/MetricCard'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import TrendLine from '../components/charts/TrendLine'
import { ListSkeleton, MetricSkeleton } from '../components/Skeletons'

export default function Overview() {
  const page = usePageChoreo([])
  const { data: ov, loading } = useApi(getOverview)
  const { data: volume, loading: volumeLoading } = useApi(() => getTrends('volume', 30), { deps: [] })
  const { data: pains, loading: painsLoading } = useApi(getPainPoints)
  const topPains = (pains ?? []).slice(0, 3)

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Overview</h1>
            <MetricInfo metricKey="overviewPage" />
          </div>
          <p className="mt-1 font-light text-muted">
            Community signal at a glance — volume, sentiment, priority and active pain points.
          </p>
        </div>
        {ov && (
          <PillTag color={ov.pipelineHealth === 'healthy' ? semantics.run.done : semantics.run.running} dot>
            Pipeline {ov.pipelineHealth}
          </PillTag>
        )}
      </header>

      {/* KPI row — 5 cards (Celeste reserved as this view's single accent) */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <MetricSkeleton key={i} />)
        ) : ov ? (
          <>
            <div data-anim="kpi">
              <MetricCard label="Total posts" value={ov.totalPosts} hint="All ingested community posts" infoKey="totalPosts" />
            </div>
            <div data-anim="kpi">
              <MetricCard
                label="Avg sentiment"
                value={ov.avgSentiment}
                format={(v) => v.toFixed(2)}
                hint="Model score from −1 to 1"
                accent={colors.celeste}
                infoKey="avgSentiment"
              />
            </div>
            <div data-anim="kpi">
              <MetricCard
                label="High-priority posts"
                value={ov.highPriorityCount}
                hint="Flagged by the priority classifier"
                accent={colors.midnight}
                infoKey="highPriority"
              />
            </div>
            <div data-anim="kpi">
              <MetricCard label="Active pain points" value={ov.activePainPoints} hint="Unresolved assistant insights" infoKey="activePainPoints" />
            </div>
            <div data-anim="kpi">
              <MetricCard
                label="Model confidence"
                value={ov.modelConfidence}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint="Average across AI stages"
                infoKey="modelConfidence"
              />
            </div>
          </>
        ) : (
          <div className="col-span-full flex items-center justify-center py-6">
            <PillTag>No data yet</PillTag>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div data-anim="chart" className="lg:col-span-2">
          <FrameCard title="Post volume — last 30 days" lift={false} infoKey="volumeTrend">
            <TrendLine data={volume} loading={volumeLoading} name="Posts" />
          </FrameCard>
        </div>
        <div data-anim="chart">
          <FrameCard
            title="Top pain points"
            accent={colors.salmon}
            lift={false}
            infoKey="topPains"
            action={
              <Link to="/pain-points" className="text-small font-medium text-blue hover:underline">
                View all
              </Link>
            }
          >
            {painsLoading ? (
              <div className="space-y-3">
                <ListSkeleton rows={2} />
              </div>
            ) : topPains.length ? (
              <ul className="space-y-4">
                {topPains.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/insights/${p.id}`}
                      className="-mx-2 block rounded-md p-2 transition-colors hover:bg-mist"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.title}</span>
                        <PillTag color={semantics.severity[p.severity]} dot>
                          {p.severity}
                        </PillTag>
                      </div>
                      <p className="mt-1 line-clamp-2 font-light text-muted">{p.body}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center justify-center py-8">
                <PillTag>No data yet</PillTag>
              </div>
            )}
          </FrameCard>
        </div>
      </div>
    </div>
  )
}

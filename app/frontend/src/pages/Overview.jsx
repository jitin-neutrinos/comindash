// Overview — the answer to "what changed, and does it need me?"
//
// The old page showed five static totals and a 30-day line. Totals alone say
// nothing: 36 high-priority posts is either calm or alarming depending on
// what last fortnight looked like. Every KPI here carries measured movement
// (routes/overview.py computes it; the client never derives a trend it did
// not receive), and the attention list is driven by live intel — momentum
// against a baseline window — rather than the analyst's frozen conclusions.
//
// Brand: White + Blue dominant, Celeste as this view's single accent, Salmon
// reserved for genuine pain severity. One accent per surface, per brand-core.
import { Link } from 'react-router-dom'
import { getOverview, getInsightIntel, getTrends, useApi, formatDate } from '../api'
import { insightPath } from '../slug'
import { alpha, colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import MetricCard from '../components/MetricCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { Bezel, SectionHead } from '../components/Surface'
import TrendLine from '../components/charts/TrendLine'
import Sparkline from '../components/insights/Sparkline'
import MomentumChip from '../components/insights/MomentumChip'
import { MOMENTUM_RANK, SEVERITY_RANK, TYPE_LABEL, typeColor } from '../components/insights/vocab'
import { InsightRowSkeleton, MetricSkeleton } from '../components/Skeletons'

/** Sort key for "what deserves attention first": momentum, then severity. */
const attentionRank = (i) =>
  (MOMENTUM_RANK[i.momentum.state] ?? 9) * 10 + (SEVERITY_RANK[i.severity] ?? 9)

export default function Overview() {
  const page = usePageChoreo([])
  const { data: ov, loading } = useApi(getOverview)
  const { data: volume, loading: volumeLoading } = useApi(() => getTrends('volume', 30), { deps: [] })
  const { data: intel, loading: intelLoading } = useApi(() => getInsightIntel({ days: 90 }), {
    deps: [],
  })

  const items = intel?.items ?? []
  const attention = [...items].sort((a, b) => attentionRank(a) - attentionRank(b)).slice(0, 4)
  const moving = items.filter((i) => i.momentum.state === 'surging' || i.momentum.state === 'rising')
  const d = ov?.deltas ?? {}

  return (
    <div ref={page} className="space-y-8">
      {/* ---- header ------------------------------------------------------ */}
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mt-2 flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Overview</h1>
            <MetricInfo metricKey="overviewPage" />
          </div>
          <p className="mt-1 max-w-2xl font-light text-muted">
            {d.posts
              ? `${Math.round(d.posts.value)} posts in the last ${d.posts.window_days} days, against ${Math.round(d.posts.previous)} in the ${d.posts.window_days} before.`
              : 'Volume, sentiment, priority and active pain points.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ov?.lastPostAt && (
            <span className="text-caption font-light text-muted">
              Newest post {formatDate(ov.lastPostAt)}
            </span>
          )}
          {ov && (
            <PillTag
              color={ov.pipelineHealth === 'healthy' ? semantics.run.done : semantics.run.running}
              dot
            >
              Pipeline {ov.pipelineHealth}
            </PillTag>
          )}
        </div>
      </header>

      {/* ---- KPI bento ------------------------------------------------------
           12-col bento grid. On xl it fills the viewport height (auto-rows-fr
           + a fixed section height), so the five KPIs compose as one hero
           surface instead of a strip of equal boxes. Every tile carries its
           real supporting data: deltas, the 14-day volume spark, the pace
           count — never a bare number in a box. */}
      <div
        className="grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-6 xl:h-[calc(100dvh-11rem)] xl:min-h-[430px] xl:grid-cols-12"
      >
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={i < 3 ? 'col-span-2 md:col-span-2 xl:col-span-4' : 'col-span-2 md:col-span-3 xl:col-span-6'}>
              <MetricSkeleton />
            </div>
          ))
        ) : ov ? (
          <>
            <div data-anim="kpi" className="col-span-2 md:col-span-2 xl:col-span-4">
              <MetricCard
                label="Total posts"
                value={ov.totalPosts}
                hint="all time"
                infoKey="totalPosts"
                delta={d.posts}
                polarity="neutral"
                spark={
                  <Sparkline
                    series={volume.slice(-14).map((v) => ({ posts: v.count }))}
                    accent={colors.blue}
                    width={128}
                    height={36}
                    showNegative={false}
                  />
                }
              />
            </div>
            <div data-anim="kpi" className="col-span-2 md:col-span-2 xl:col-span-4">
              <MetricCard
                label="Avg sentiment"
                value={ov.avgSentiment}
                format={(v) => v.toFixed(2)}
                hint="−1 to 1"
                accent={colors.celeste}
                infoKey="avgSentiment"
                /* The delta is the count of negative-sentiment posts, so it
                   belongs to the sentiment reading. More negative posts is
                   worse, hence inverse polarity. */
                delta={d.negative}
                polarity="inverse"
                deltaLabel="negative posts"
              />
            </div>
            <div data-anim="kpi" className="col-span-2 md:col-span-2 xl:col-span-4">
              <MetricCard
                label="High-priority"
                value={ov.highPriorityCount}
                hint="all time"
                accent={colors.midnight}
                infoKey="highPriority"
                delta={d.high_priority}
                /* More high-priority posts is worse, so up must read red. */
                polarity="inverse"
              />
            </div>
            <div data-anim="kpi" className="col-span-2 md:col-span-3 xl:col-span-6">
              <MetricCard
                label="Active pain points"
                value={ov.activePainPoints}
                hint={moving.length ? `${moving.length} gaining pace right now` : 'unresolved'}
                accent={colors.salmon}
                infoKey="activePainPoints"
                /* No delta here on purpose: the `negative` window counts
                   negative-sentiment POSTS, not pain-point insights. Pinning
                   it to this number would claim a movement it doesn't measure.
                   The pace count in the hint is the honest movement signal. */
              />
            </div>
            <div data-anim="kpi" className="col-span-2 md:col-span-3 xl:col-span-6">
              <MetricCard
                label="Model confidence"
                value={ov.modelConfidence}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint="across AI stages"
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

      {/* ---- needs attention ---------------------------------------------- */}
      <div data-anim="chart">
        <SectionHead
          eyebrow={moving.length ? `${moving.length} gaining pace` : 'live ranking'}
          title="Needs attention"
          accent={colors.salmon}
          info={<MetricInfo metricKey="topPains" />}
          action={
            <Link to="/insights" className="text-small font-medium text-blue hover:underline">
              All insights →
            </Link>
          }
        />
        {intelLoading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <InsightRowSkeleton key={i} variant={i} compact />)}
          </div>
        ) : attention.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {attention.map((i) => {
              const accent = typeColor(i.insightType)
              return (
                <Bezel key={i.id} accent={accent} radius={18} pad={4} lift>
                  <Link to={insightPath(i)} className="block h-full p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-caption font-medium uppercase tracking-wide"
                        style={{ color: accent }}
                      >
                        {TYPE_LABEL(i.insightType)}
                      </span>
                      <PillTag color={semantics.severity[i.severity]} dot>
                        {i.severity}
                      </PillTag>
                      <MomentumChip
                        state={i.momentum.state}
                        deltaPct={i.momentum.deltaPct}
                        size="sm"
                      />
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-body font-medium leading-snug">
                      {i.title}
                    </h3>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="flex items-end gap-4">
                        <div>
                          <p className="text-h4 font-semibold leading-none tabular-nums">
                            {i.scope.posts}
                          </p>
                          <p className="text-caption text-muted">posts in scope</p>
                        </div>
                        <div>
                          <p
                            className="text-h4 font-semibold leading-none tabular-nums"
                            style={{
                              color: i.scope.negativeShare > 0.3 ? colors.salmon : undefined,
                            }}
                          >
                            {Math.round((i.scope.negativeShare ?? 0) * 100)}%
                          </p>
                          <p className="text-caption text-muted">negative</p>
                        </div>
                      </div>
                      <Sparkline series={i.series} accent={accent} width={120} height={34} />
                    </div>
                  </Link>
                </Bezel>
              )
            })}
          </div>
        ) : (
          <Bezel accent={colors.celeste} radius={18} pad={4}>
            <div className="flex items-center justify-center py-8">
              <PillTag>Nothing active right now</PillTag>
            </div>
          </Bezel>
        )}
      </div>

      {/* ---- volume + shortcuts -------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div data-anim="chart" className="lg:col-span-2">
          <Bezel accent={colors.celeste} radius={20}>
            <div className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-h4 font-semibold tracking-tight">Post volume</h2>
                <span className="text-caption text-muted">last 30 days</span>
                <MetricInfo metricKey="volumeTrend" />
              </div>
              <TrendLine data={volume} loading={volumeLoading} name="Posts" />
            </div>
          </Bezel>
        </div>

        <div data-anim="chart">
          <Bezel accent={colors.blue} radius={20} className="h-full">
            <div className="flex h-full flex-col p-6">
              <h2 className="text-h4 font-semibold tracking-tight">Go deeper</h2>
              <p className="mt-1 text-caption font-light text-muted">
                The three views that answer follow-up questions.
              </p>
              <ul className="mt-4 space-y-2">
                {[
                  {
                    to: '/insights',
                    title: 'Insights',
                    note: `${intel?.items.length ?? 0} active, ranked by momentum`,
                  },
                  {
                    to: '/relationships',
                    title: 'Knowledge graph',
                    note: 'who and what keep appearing together',
                  },
                  {
                    to: '/metrics',
                    title: 'Metrics explorer',
                    note: 'sentiment, priority and entities over time',
                  },
                ].map((l) => (
                  <li key={l.to}>
                    <Link
                      to={l.to}
                      className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-mist"
                    >
                      <span
                        className="h-8 w-1 shrink-0 rounded-pill"
                        style={{ backgroundColor: alpha(colors.blue, 0.35) }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="block text-small font-medium">{l.title}</span>
                        <span className="block text-caption font-light text-muted">{l.note}</span>
                      </span>
                      <span className="ml-auto text-muted" aria-hidden="true">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Bezel>
        </div>
      </div>
    </div>
  )
}

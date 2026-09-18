import { Link } from 'react-router-dom'
import { getPainPoints, useApi } from '../api'
import { colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import SeverityRing from '../components/charts/SeverityRing'
import { ListSkeleton } from '../components/Skeletons'

const RANK = { high: 0, medium: 1, low: 2 }

export default function PainPoints() {
  const page = usePageChoreo([])
  const { data: pains, loading } = useApi(getPainPoints)
  const sorted = [...(pains ?? [])].sort(
    (a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3),
  )
  const mix = ['high', 'medium', 'low'].map((sev) => ({
    label: sev[0].toUpperCase() + sev.slice(1),
    value: (pains ?? []).filter((p) => p.severity === sev).length,
    color: semantics.severity[sev],
  }))

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header">
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Pain points</h1>
          <MetricInfo metricKey="painPointsPage" />
        </div>
        <p className="mt-1 font-light text-muted">
          Ranked community friction surfaced by the analyst assistant, each backed by post evidence.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div data-anim="chart">
          <FrameCard title="Severity mix" accent={colors.salmon} lift={false} infoKey="severityMix">
            <SeverityRing data={mix} loading={loading} centerLabel="pain points" />
          </FrameCard>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {loading ? (
            <ListSkeleton rows={4} />
          ) : sorted.length ? (
            sorted.map((p, i) => (
              <div key={p.id} data-anim="row">
                <FrameCard accent={semantics.severity[p.severity] ?? colors.celeste}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="text-h4 font-semibold tracking-tight">
                        <span className="mr-2 font-light text-muted">{i + 1}.</span>
                        {p.title}
                      </h2>
                      <MetricInfo
                        metricKey="painPointItem"
                        accent={semantics.severity[p.severity] ?? colors.celeste}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <PillTag color={semantics.severity[p.severity]} dot>
                        {p.severity}
                      </PillTag>
                      <PillTag>{p.evidenceCount} evidence</PillTag>
                    </div>
                  </div>
                  <p className="mt-3 font-light leading-relaxed">{p.body}</p>
                  <Link
                    to={`/insights/${p.id}`}
                    className="mt-4 inline-block text-small font-medium text-blue hover:underline"
                  >
                    View insight
                  </Link>
                </FrameCard>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center py-16">
              <PillTag>No data yet</PillTag>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

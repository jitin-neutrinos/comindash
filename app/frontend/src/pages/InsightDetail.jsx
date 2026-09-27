import { useNavigate, useParams } from 'react-router-dom'
import { getInsight, useApi, formatDate } from '../api'
import { alpha, colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { ListSkeleton } from '../components/Skeletons'

export default function InsightDetail() {
  const page = usePageChoreo([])
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: insight, loading, error } = useApi(() => getInsight(id), { deps: [id] })

  if (loading) return <ListSkeleton rows={3} />

  if (error || !insight) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <PillTag color={semantics.severity.high} dot>
          Insight not found
        </PillTag>
        <p className="font-light text-muted">
          {error?.message ?? 'It may have been superseded or removed.'}
        </p>
      </div>
    )
  }

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header" className="space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-block rounded-pill px-0 py-1 text-small font-medium text-blue hover:underline"
        >
          ← Back
        </button>
        <div className="flex items-start gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">{insight.title}</h1>
          <span className="mt-2">
            <MetricInfo metricKey="insightPage" />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PillTag>{insight.insightType.replace(/_/g, ' ')}</PillTag>
          <PillTag color={semantics.severity[insight.severity]} dot>
            {insight.severity}
          </PillTag>
          <PillTag color={semantics.status[insight.status] ?? semantics.run.pending} dot>
            {insight.status}
          </PillTag>
          {insight.createdAt && (
            <span className="text-caption font-light text-muted">
              First seen {formatDate(insight.createdAt)}
            </span>
          )}
        </div>
      </header>

      <div data-anim="chart">
        <FrameCard title="What the assistant found" accent={colors.blue} lift={false} infoKey="insightBody">
          <p className="whitespace-pre-line font-light leading-relaxed">{insight.body}</p>
        </FrameCard>
      </div>

      <div data-anim="chart">
        <FrameCard title={`Evidence (${insight.evidence.length})`} accent={colors.celeste} lift={false} infoKey="insightEvidence">
          {insight.evidence.length ? (
            <ul className="space-y-5">
              {insight.evidence.map((e, i) => (
                <li key={`${e.postId}-${i}`} className="pl-4">
                  <blockquote className="italic">{e.quote}</blockquote>
                  {e.relevanceNote && (
                    <p className="mt-1 text-small font-light text-muted">{e.relevanceNote}</p>
                  )}
                  <p className="mt-1 text-caption font-light text-muted">
                    Community post #{e.postId}
                    {e.url && (
                      <>
                        {' — '}
                        <a href={e.url} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                          View on the forum
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center justify-center py-6">
              <PillTag>No data yet</PillTag>
            </div>
          )}
        </FrameCard>
      </div>

      {insight.relationships.length > 0 && (
        <div data-anim="chart">
          <FrameCard title="Relationships" accent={colors.iris} lift={false} infoKey="insightRelationships">
            <ul className="space-y-4">
              {insight.relationships.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-small">
                    <span className="font-medium">{r.subject}</span>{' '}
                    <span className="font-light text-muted">{r.relation}</span>{' '}
                    <span className="font-medium">{r.object}</span>
                  </p>
                  <span
                    className="h-1.5 w-24 rounded-pill"
                    aria-label={`Strength ${(r.strength * 100).toFixed(0)}%`}
                    style={{ backgroundColor: alpha(colors.iris, 0.15 + 0.8 * Math.min(r.strength, 1)) }}
                  />
                </li>
              ))}
            </ul>
          </FrameCard>
        </div>
      )}
    </div>
  )
}

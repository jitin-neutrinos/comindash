// The full record for one insight.
//
// The old page listed the analyst's frozen conclusion and its cited quotes.
// This leads with a freshly generated AI briefing measured against the
// insight's scope *as it stands now*, then shows the record it was drawn
// from. Reading order matches decision order: what it means, what to do,
// then the evidence you can check it against.
//
// URL contract: the route param is a ref (`30` or `stale-jbpm-...-30`). On
// load we canonicalise the address bar to the slug form the server returns,
// with `replace` so Back never lands on the un-canonical spelling.
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getInsight, getInsightClaims, useApi, formatDate } from '../api'
import { insightPath } from '../slug'
import { alpha, colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { Bezel, Eyebrow, SectionHead } from '../components/Surface'
import BriefPanel from '../components/insights/BriefPanel'
import ClaimCheck from '../components/insights/ClaimCheck'
import { DetailSkeleton } from '../components/Skeletons'
import { TYPE_LABEL, typeColor } from '../components/insights/vocab'

const DISCOURSE = 'https://community.neutrinos.com'

/** Analyst bodies arrive as prose with blank-line paragraph breaks. */
function Prose({ text, className = '' }) {
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!paras.length) return null
  return (
    <div className={`prose-brief text-body font-light ${className}`}>
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  )
}

export default function InsightDetail() {
  const page = usePageChoreo([])
  const { ref } = useParams()
  const navigate = useNavigate()
  const { data: insight, loading, error } = useApi(() => getInsight(ref), { deps: [ref] })
  // Claims are verified in a separate request: the measurement scans the whole
  // corpus, and the record should render immediately rather than wait on it.
  const {
    data: claims,
    loading: claimsLoading,
    error: claimsError,
  } = useApi(() => getInsightClaims(ref), { deps: [ref] })

  // Canonicalise the URL once the server tells us the real slug. `replace`
  // keeps the pre-canonical address out of history, so Back does not bounce
  // between two spellings of the same page.
  useEffect(() => {
    if (!insight?.slug) return
    const canonical = insightPath(insight)
    if (window.location.pathname !== canonical) {
      navigate(canonical, { replace: true })
    }
  }, [insight, navigate])

  if (loading) {
    return (
      <div ref={page} className="space-y-6">
        <DetailSkeleton />
      </div>
    )
  }

  if (error || !insight) {
    return (
      <div ref={page}>
        <FrameCard lift={false}>
          <div className="py-12 text-center">
            <PillTag color={semantics.severity.high} dot>
              Insight not found
            </PillTag>
            <p className="mt-3 font-light text-muted">
              {error?.message ?? `Nothing matches “${ref}”. It may have been superseded or removed.`}
            </p>
            <Link
              to="/insights"
              className="mt-5 inline-flex items-center gap-2 rounded-pill px-4 py-2 text-small font-medium text-white"
              style={{ backgroundColor: colors.blue }}
            >
              Browse all insights
            </Link>
          </div>
        </FrameCard>
      </div>
    )
  }

  const accent = typeColor(insight.insightType)
  const sevColor = semantics.severity[insight.severity] ?? colors.blue
  const statusColor = semantics.status[insight.status] ?? semantics.run.pending

  // BriefPanel is the same component the Insights list uses, so both surfaces
  // make identical claims under identical grounding rules. `embedded` drops
  // its momentum/scope header, which needs intel data this payload lacks —
  // rendering it here would mean inventing those figures.
  const briefItem = {
    id: insight.id,
    slug: insight.slug,
    title: insight.title,
    insightType: insight.insightType,
    severity: insight.severity,
    status: insight.status,
    related: [],
  }

  return (
    <div ref={page} className="space-y-6">
      {/* ---- header ------------------------------------------------------ */}
      <header data-anim="header">
        <Link
          to="/insights"
          className="inline-flex items-center gap-1.5 text-small font-medium text-muted transition-colors hover:text-blue"
        >
          <span aria-hidden="true">←</span> All insights
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Eyebrow color={accent}>{TYPE_LABEL(insight.insightType)}</Eyebrow>
          <PillTag color={sevColor} dot>
            {insight.severity} severity
          </PillTag>
          <PillTag color={statusColor} dot>
            {insight.status}
          </PillTag>
          {insight.createdAt && (
            <span className="text-caption font-light text-muted">
              First seen {formatDate(insight.createdAt)}
            </span>
          )}
        </div>
        <div className="mt-3 flex items-start gap-2">
          <h1 className="max-w-4xl text-h2 font-semibold leading-tight tracking-tight">
            {insight.title}
          </h1>
          <span className="mt-2 shrink-0">
            <MetricInfo metricKey="insightPage" />
          </span>
        </div>
      </header>

      {/* ---- the analyst's frozen conclusion ------------------------------ */}
      <div data-anim="chart">
        <Bezel accent={accent} radius={22}>
          <div className="p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <h2 className="text-caption font-semibold uppercase tracking-[0.14em] text-muted">
                What the assistant found
              </h2>
              <MetricInfo metricKey="insightBody" />
            </div>
            <Prose text={insight.body} className="mt-3 max-w-[68ch]" />
          </div>
        </Bezel>
      </div>

      {/* ---- live AI briefing --------------------------------------------- */}
      <div data-anim="chart">
        <SectionHead
          eyebrow="Generated now"
          title="What this means today"
          accent={accent}
          info={<MetricInfo metricKey="insightBrief" />}
        />
        <BriefPanel item={briefItem} embedded />
      </div>

      {/* ---- evidence ------------------------------------------------------ */}
      <div data-anim="chart">
        <SectionHead
          eyebrow={insight.evidence.length ? `${insight.evidence.length} cited` : 'none cited'}
          title="Evidence the assistant quoted"
          accent={accent}
          info={<MetricInfo metricKey="insightEvidence" />}
        />
        {insight.evidence.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {insight.evidence.map((e, i) => (
              <Bezel key={`${e.postId}-${i}`} accent={accent} radius={18} pad={4} lift>
                <figure className="flex h-full flex-col p-5">
                  <blockquote
                    className="border-l-2 pl-3 text-small font-light italic leading-relaxed"
                    style={{ borderColor: alpha(accent, 0.45) }}
                  >
                    {e.quote}
                  </blockquote>
                  {e.relevanceNote && (
                    <figcaption className="mt-3 text-caption font-light leading-relaxed text-muted">
                      {e.relevanceNote}
                    </figcaption>
                  )}
                  <div className="mt-auto pt-3">
                    <a
                      href={e.url || `${DISCOURSE}/p/${e.postId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-caption font-medium text-blue hover:underline"
                    >
                      Community post #{e.postId} →
                    </a>
                  </div>
                </figure>
              </Bezel>
            ))}
          </div>
        ) : (
          <Bezel accent={accent} radius={18} pad={4}>
            <div className="flex items-center justify-center py-8">
              <PillTag>No quoted evidence on this insight</PillTag>
            </div>
          </Bezel>
        )}
      </div>

      {/* ---- asserted relationships, checked against the corpus ------------- */}
      {insight.relationships.length > 0 && (
        <div data-anim="chart">
          <SectionHead
            eyebrow={
              claims
                ? `${claims.summary.supported} of ${claims.summary.total} backed by the data`
                : `${insight.relationships.length} claimed`
            }
            title="What this insight claims — and whether it holds up"
            accent={accent}
            info={<MetricInfo metricKey="insightRelationships" />}
            action={
              <Link to="/relationships" className="text-small font-medium text-blue hover:underline">
                See the knowledge graph →
              </Link>
            }
          />
          <ClaimCheck data={claims} loading={claimsLoading} error={claimsError} />
        </div>
      )}
    </div>
  )
}

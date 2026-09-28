// The briefing panel: the counterpart to the Relationships page's InsightPanel.
//
// It answers a different question than the list does. The list says what is
// happening; this says what it means and what to do, grounded in the posts
// that are actually in the insight's scope right now.
//
// Two rules it never breaks:
//   1. A measurement-only fallback is labelled as one. It never wears the
//      styling of model analysis.
//   2. Every post shown is a real row with a link out to Discourse. Nothing
//      in this panel is unfalsifiable.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getInsightBrief, formatDate } from '../../api'
import { insightPath } from '../../slug'
import { colors, semantics, alpha } from '../../theme'
import { gsap, canAnimateEntrance } from '../../motion'
import PillTag from '../PillTag'
import Sparkline from './Sparkline'
import MomentumChip from './MomentumChip'
import { confidenceOf, TYPE_LABEL, typeColor, momentumOf, scopeModeOf, pct } from './vocab'

const DISCOURSE = 'https://community.neutrinos.com'

function BriefSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="shimmer h-4 w-4/5 rounded-sm" />
      <div className="shimmer h-3 w-full rounded-sm" />
      <div className="shimmer h-3 w-11/12 rounded-sm" />
      <div className="shimmer h-3 w-2/3 rounded-sm" />
      <div className="mt-5 space-y-2">
        <div className="shimmer h-3 w-1/3 rounded-sm" />
        <div className="shimmer h-3 w-full rounded-sm" />
        <div className="shimmer h-3 w-5/6 rounded-sm" />
      </div>
    </div>
  )
}

function Section({ title, children, accent }) {
  return (
    <section className="mt-5">
      <h4
        className="text-caption font-semibold uppercase tracking-wide"
        style={{ color: accent ?? colors.black }}
      >
        {title}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/**
 * @param {object} item   Insight, intel-shaped on the Insights list. When
 *   `embedded` is set, only `id`/`slug`/`insightType`/`related` are required.
 * @param {boolean} embedded  Render the briefing body alone, without the
 *   momentum/scope header. The insight detail page supplies its own header
 *   and has no intel payload — rendering the header there would mean
 *   inventing momentum and scope figures, which this component never does.
 */
export default function BriefPanel({ item, onClose, embedded = false }) {
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const panel = useRef(null)
  const bodyRef = useRef(null)

  const accent = typeColor(item.insightType)
  // Intel-only fields; absent on the detail page, where the header is skipped.
  const m = momentumOf(item.momentum?.state)
  const scopeMode = scopeModeOf(item.scope?.mode)
  // Prefer the canonical slug so the request URL matches the page URL.
  const briefRef = item.slug ?? item.id

  const load = (refresh = false) => {
    setLoading(true)
    setError(null)
    getInsightBrief({ ref: briefRef, refresh })
      .then((b) => setBrief(b))
      .catch((e) => setError(e))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let cancelled = false
    setBrief(null)
    setLoading(true)
    setError(null)
    getInsightBrief({ ref: briefRef })
      .then((b) => !cancelled && setBrief(b))
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [briefRef])

  // Panel entrance. Content must never depend on the tween having run:
  // progress(1) before kill so a re-run effect cannot strand it at autoAlpha 0.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el || !canAnimateEntrance()) return undefined
    const tl = gsap.timeline()
    tl.fromTo(el, { autoAlpha: 0, x: 16 }, { autoAlpha: 1, x: 0, duration: 0.35 })
    return () => tl.progress(1).kill()
  }, [item.id])

  // Stagger the brief's sections in once they arrive — reinforces reading
  // order (headline, then meaning, then what to do).
  useLayoutEffect(() => {
    if (!brief || !bodyRef.current || !canAnimateEntrance()) return undefined
    const parts = bodyRef.current.querySelectorAll('[data-brief-part]')
    if (!parts.length) return undefined
    const tl = gsap.fromTo(
      parts,
      { autoAlpha: 0, y: 10 },
      { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out' },
    )
    return () => tl.progress(1).kill()
  }, [brief])

  const isFallback = brief?.mode === 'evidence'

  return (
    <div
      ref={panel}
      className="rounded-xl border border-line bg-surface"
      style={{ boxShadow: '0 8px 24px rgba(0,5,61,0.10)' }}
      role="complementary"
      aria-label="Insight briefing"
    >
      {/* Header — identity, state, and the measured shape, all above the fold */}
      {!embedded && (
      <div
        className="rounded-t-xl border-b border-hairline px-5 py-4"
        style={{ backgroundColor: alpha(accent, 0.05) }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-caption font-medium uppercase tracking-wide"
                style={{ color: accent }}
              >
                {TYPE_LABEL(item.insightType)}
              </span>
              <PillTag color={semantics.severity[item.severity]} dot>
                {item.severity}
              </PillTag>
              <MomentumChip
                state={item.momentum.state}
                deltaPct={item.momentum.deltaPct}
                size="sm"
                pulse
              />
            </div>
            <h3 className="mt-2 text-h4 font-semibold leading-snug tracking-tight">{item.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close briefing"
            className="shrink-0 rounded-md px-2 py-1 text-muted transition-colors hover:bg-hairline hover:text-black"
          >
            ✕
          </button>
        </div>

        <p className="mt-3 text-small font-light leading-relaxed text-muted">{m.meaning}</p>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <div>
              <p className="text-h4 font-semibold tabular-nums leading-none">{item.scope.posts}</p>
              <p className="text-caption text-muted" title={scopeMode.note}>
                posts in scope
              </p>
            </div>
            <div>
              <p className="text-h4 font-semibold tabular-nums leading-none">
                {item.momentum.recentPosts}
                <span className="text-small font-light text-muted">
                  {' '}
                  in {item.momentum.recentDays}d
                </span>
              </p>
              {/* Rate, not the raw baseline count: the windows are different
                  lengths, so "2 / 1" would read as a doubling when it is
                  actually a 4x rate change. State the comparable number. */}
              <p className="text-caption text-muted">
                vs {(item.momentum.baselinePosts * (item.momentum.recentDays / item.momentum.baselineDays)).toFixed(1)}{' '}
                expected at prior rate
              </p>
            </div>
            <div>
              <p
                className="text-h4 font-semibold tabular-nums leading-none"
                style={{ color: item.scope.negativeShare > 0.3 ? colors.salmon : undefined }}
              >
                {pct(item.scope.negativeShare)}
              </p>
              <p className="text-caption text-muted">negative</p>
            </div>
          </div>
          <Sparkline series={item.series} accent={accent} width={150} height={40} />
        </div>

        <p className="mt-3 text-caption text-muted">
          <span className="font-medium">{scopeMode.label} scope.</span> {scopeMode.note} Covers{' '}
          {pct(item.scope.corpusShare)} of all posts.
        </p>
      </div>
      )}

      {/* Body — the briefing */}
      <div className="px-5 py-4">
        {loading && <BriefSkeleton />}

        {!loading && error && (
          <div className="rounded-md border border-line p-3">
            <p className="text-small font-medium text-salmon">Briefing unavailable</p>
            <p className="mt-1 text-caption text-muted">{String(error.message ?? error)}</p>
            <button
              type="button"
              onClick={() => load(false)}
              className="mt-2 text-small font-medium text-blue hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && brief && (
          <div ref={bodyRef}>
            <div data-brief-part className="flex flex-wrap items-center gap-2">
              <PillTag color={confidenceOf()[brief.confidence] ?? colors.blue} dot>
                {brief.confidence} confidence
              </PillTag>
              {isFallback ? (
                <PillTag color={alpha(colors.black, 0.5)}>measurements only</PillTag>
              ) : (
                <PillTag color={colors.mint}>AI analysis</PillTag>
              )}
              {brief.cached && <PillTag>cached</PillTag>}
              <button
                type="button"
                onClick={() => load(true)}
                className="ml-auto text-caption font-medium text-blue hover:underline"
              >
                Regenerate
              </button>
            </div>

            {isFallback && brief.reason && (
              <p
                data-brief-part
                className="mt-2 rounded-md px-3 py-2 text-caption text-muted"
                style={{ backgroundColor: alpha(colors.black, 0.04) }}
              >
                The model could not be reached, so this is measured data only — no analysis was
                generated. ({brief.reason})
              </p>
            )}

            <p data-brief-part className="mt-3 text-body font-medium leading-relaxed">
              {brief.headline}
            </p>

            {brief.soWhat && (
              <p data-brief-part className="mt-2 font-light leading-relaxed text-muted">
                {brief.soWhat}
              </p>
            )}

            {brief.actions.length > 0 && (
              <div data-brief-part>
                <Section title="What to do" accent={accent}>
                  <ol className="space-y-2">
                    {brief.actions.map((a, i) => (
                      <li key={i} className="flex gap-2.5 text-small leading-relaxed">
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-caption font-semibold"
                          style={{ backgroundColor: alpha(accent, 0.14), color: accent }}
                        >
                          {i + 1}
                        </span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ol>
                </Section>
              </div>
            )}

            {brief.drivers.length > 0 && (
              <div data-brief-part>
                <Section title="What's driving it">
                  <ul className="space-y-1.5">
                    {brief.drivers.map((d, i) => (
                      <li key={i} className="flex gap-2 text-small leading-relaxed text-muted">
                        <span aria-hidden="true" style={{ color: accent }}>
                          ·
                        </span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            )}

            {brief.watchOut && (
              <div data-brief-part>
                <Section title="Watch out" accent={colors.salmon}>
                  <p
                    className="rounded-md px-3 py-2 text-small leading-relaxed"
                    style={{ backgroundColor: alpha(colors.salmon, 0.07) }}
                  >
                    {brief.watchOut}
                  </p>
                </Section>
              </div>
            )}

            {item.related.length > 0 && (
              <div data-brief-part>
                <Section title="Connected insights">
                  <ul className="space-y-1.5">
                    {item.related.map((r) => (
                      <li key={r.id} className="text-small">
                        <Link to={insightPath(r)} className="text-blue hover:underline">
                          {r.title}
                        </Link>
                        <span className="text-caption text-muted"> · shares {r.shared.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            )}

            {brief.posts.length > 0 && (
              <div data-brief-part>
                <Section title={`Newest posts in scope (${brief.posts.length})`}>
                  <ul className="space-y-2.5">
                    {brief.posts.map((p) => (
                      <li key={p.postId} className="border-l-2 pl-3" style={{ borderColor: alpha(accent, 0.3) }}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.topicId ? (
                            <a
                              href={`${DISCOURSE}/t/${p.slug || 'topic'}/${p.topicId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-small font-medium text-blue hover:underline"
                            >
                              {p.topic || 'Untitled topic'}
                            </a>
                          ) : (
                            <span className="text-small font-medium">{p.topic || 'Untitled topic'}</span>
                          )}
                          {p.isEvidence && <PillTag color={colors.mint}>cited</PillTag>}
                          {p.highPriority && <PillTag color={colors.midnight}>high</PillTag>}
                          {p.negative && <PillTag color={colors.salmon}>negative</PillTag>}
                          {p.createdAt && (
                            <span className="text-caption text-muted">{formatDate(p.createdAt)}</span>
                          )}
                        </div>
                        <p className="mt-1 text-caption font-light leading-relaxed text-muted line-clamp-3">
                          {p.excerpt}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Section>
              </div>
            )}

            {/* On the detail page this footer would link to the page you are
                already reading, so it is list-only. */}
            {!embedded && (
            <div data-brief-part className="mt-5 flex items-center justify-between border-t border-hairline pt-3">
              <Link
                to={insightPath(item)}
                className="text-small font-medium text-blue hover:underline"
              >
                Full insight record →
              </Link>
              <span className="text-caption text-muted">
                {item.lineage.cycles > 1
                  ? `Raised ${item.lineage.cycles}× · first ${formatDate(item.firstSeen)}`
                  : `First seen ${formatDate(item.firstSeen)}`}
              </span>
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

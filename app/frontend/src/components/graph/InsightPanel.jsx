import { useEffect, useRef, useState } from 'react'
import { getRelationshipBrief } from '../../api'
import { alpha, colors } from '../../theme'
import { canAnimateEntrance, gsap } from '../../motion'
import PillTag from '../PillTag'
import { KIND_STYLE } from './KnowledgeGraph'

const CONFIDENCE = {
  high: { label: 'High confidence', color: colors.mint },
  medium: { label: 'Medium confidence', color: colors.blue },
  low: { label: 'Low confidence', color: colors.salmon },
}

function Line({ w = '100%' }) {
  return <div className="shimmer h-3 rounded-sm" style={{ width: w }} />
}

function BriefSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Generating briefing">
      <div className="space-y-2">
        <Line w="92%" />
        <Line w="86%" />
        <Line w="64%" />
      </div>
      <div className="space-y-2">
        <Line w="40%" />
        <Line w="78%" />
      </div>
      <p className="text-caption font-light text-muted">
        Reading the posts behind this link and writing the briefing…
      </p>
    </div>
  )
}

/**
 * Deep-wiki style briefing for one selected node or edge.
 *
 * Everything here is either measured (counts from the graph) or generated from
 * the real posts underneath the selection — with the evidence listed below the
 * narrative so a reader can always check the claim against the source. When
 * the model is unreachable the panel says so plainly and shows evidence only;
 * it never presents a fallback as an AI conclusion.
 */
export default function InsightPanel({ selection, graph, onSelect, onClose }) {
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const panel = useRef(null)
  const bodyRef = useRef(null)

  const key = selection ? selection.keys.join('|') : ''

  useEffect(() => {
    if (!selection) {
      setBrief(null)
      setError(null)
      return undefined
    }
    let alive = true
    setLoading(true)
    setError(null)
    setBrief(null)
    getRelationshipBrief({
      keys: selection.keys,
      labels: selection.labels,
      stats:
        selection.type === 'edge'
          ? {
              co_mention_posts: selection.edge?.posts ?? 0,
              asserted_relation: selection.edge?.relation ?? '',
              asserted_strength: selection.edge?.weight ?? null,
            }
          : {
              mentions: selection.node?.weight ?? 0,
              connections: selection.node?.degree ?? 0,
            },
    })
      .then((d) => alive && setBrief(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enter animation on selection change — content crossfades, panel does not
  // slide every time (a panel that re-slides on each click reads as jumpy).
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !canAnimateEntrance()) return undefined
    const tw = gsap.fromTo(
      el,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.24, ease: 'power3.out' },
    )
    // progress(1) before kill: this effect re-runs on every loading flip, and a
    // tween killed mid-flight would strand the panel at autoAlpha 0 — i.e. a
    // perfectly good briefing rendered invisible.
    return () => tw.progress(1).kill()
  }, [key, loading])

  useEffect(() => {
    const el = panel.current
    if (!el || !selection || !canAnimateEntrance()) return undefined
    const tw = gsap.fromTo(
      el,
      { autoAlpha: 0, x: 16 },
      { autoAlpha: 1, x: 0, duration: 0.28, ease: 'power3.out' },
    )
    return () => tw.progress(1).kill()
  }, [Boolean(selection)]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selection) return <EmptyPanel graph={graph} onSelect={onSelect} />

  const isEdge = selection.type === 'edge'
  const parties = selection.keys.map((k) => ({
    id: k,
    label: selection.labels?.[k] ?? k,
    kind: k.split(':')[0] === 'person' ? 'person' : k.split(':')[0] === 'product' ? 'product' : 'concept',
  }))
  const conf = CONFIDENCE[brief?.confidence] ?? CONFIDENCE.medium
  const node = selection.node

  return (
    <aside
      ref={panel}
      className="flex h-full flex-col rounded-2xl border border-line bg-white"
      aria-label="Relationship briefing"
    >
      {/* --- header ------------------------------------------------------- */}
      <header className="border-b border-line px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-[0.12em] text-muted">
              {isEdge ? 'Connection' : KIND_STYLE[parties[0].kind]?.label ?? 'Entity'}
            </p>
            <h2 className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-h4 font-semibold leading-snug tracking-tight">
              {parties.map((p, i) => (
                <span key={p.id} className="inline-flex items-center gap-2">
                  {i > 0 && (
                    <span className="font-light text-muted" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_STYLE[p.kind]?.fill ?? colors.blue }}
                  />
                  <span className="break-words">{p.label}</span>
                </span>
              ))}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close briefing"
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-mist hover:text-midnight"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {isEdge && selection.edge?.kind === 'asserted' ? (
            <PillTag color={colors.celeste} dot>
              {String(selection.edge.relation).replace(/_/g, ' ')}
            </PillTag>
          ) : isEdge ? (
            <PillTag color={colors.blue} dot>
              {selection.edge?.posts ?? 0} shared posts
            </PillTag>
          ) : (
            <>
              <PillTag color={colors.blue} dot>
                {node?.weight ?? 0} mentions
              </PillTag>
              <PillTag>{node?.degree ?? 0} connections</PillTag>
            </>
          )}
          {brief && !loading && (
            <PillTag color={conf.color} dot>
              {conf.label}
            </PillTag>
          )}
        </div>
      </header>

      {/* --- body --------------------------------------------------------- */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading && <BriefSkeleton />}

        {!loading && error && (
          <div className="rounded-xl border border-line bg-mist px-4 py-3 text-small font-light">
            Could not load this briefing: {error}
          </div>
        )}

        {!loading && brief && (
          <div className="space-y-6">
            {node?.description && (
              <p className="rounded-xl bg-mist px-4 py-3 text-small font-light leading-relaxed">
                {node.description}
              </p>
            )}

            {brief.mode === 'evidence' && (
              <p
                className="rounded-xl border-l-2 px-4 py-3 text-small font-light leading-relaxed"
                style={{ borderColor: colors.salmon, backgroundColor: alpha(colors.salmon, 0.06) }}
              >
                The AI narrative is unavailable right now, so this shows the measured evidence
                only — nothing below is model-written.
              </p>
            )}

            {brief.summary && (
              <section>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-muted">
                  What this is
                </h3>
                <p className="text-body font-light leading-relaxed">{brief.summary}</p>
              </section>
            )}

            {brief.why_it_matters && (
              <section
                className="rounded-xl border-l-2 py-3 pl-4 pr-4"
                style={{ borderColor: colors.blue, backgroundColor: alpha(colors.blue, 0.04) }}
              >
                <h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em] text-blue">
                  Why it matters
                </h3>
                <p className="text-small font-light leading-relaxed">{brief.why_it_matters}</p>
              </section>
            )}

            {brief.signals?.length > 0 && (
              <section>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-muted">
                  Signals in the posts
                </h3>
                <ul className="space-y-2.5">
                  {brief.signals.map((s, i) => (
                    <li key={i} className="flex gap-3 text-small font-light leading-relaxed">
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colors.blue }}
                      />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {brief.watch_out && (
              <section
                className="rounded-xl border-l-2 py-3 pl-4 pr-4"
                style={{ borderColor: colors.salmon, backgroundColor: alpha(colors.salmon, 0.05) }}
              >
                <h3 className="mb-1 text-caption font-semibold uppercase tracking-[0.12em]" style={{ color: colors.salmon }}>
                  Watch out
                </h3>
                <p className="text-small font-light leading-relaxed">{brief.watch_out}</p>
              </section>
            )}

            {brief.evidence?.length > 0 && (
              <section>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-muted">
                  Evidence · {brief.evidence.length} posts
                </h3>
                <ul className="space-y-2">
                  {brief.evidence.map((e) => (
                    <li key={e.post_id}>
                      <a
                        href={`https://community.neutrinos.com/t/${e.slug || 'topic'}/${e.topic_id}/${e.discourse_post_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-line px-4 py-3 transition-colors hover:border-blue hover:bg-mist"
                      >
                        <p className="text-small font-medium leading-snug text-midnight">{e.topic}</p>
                        <p className="mt-1 line-clamp-3 text-small font-light leading-relaxed text-muted">
                          {e.excerpt}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {node?.meta?.insight_titles?.length > 0 && (
              <section>
                <h3 className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-muted">
                  Related nightly insights
                </h3>
                <ul className="space-y-1.5">
                  {node.meta.insight_titles.slice(0, 4).map((t, i) => (
                    <li key={i} className="text-small font-light leading-relaxed text-muted">
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-line px-6 py-3">
        <p className="text-caption font-light text-muted">
          {brief?.cached
            ? 'Cached briefing — regenerated weekly or when the model changes.'
            : brief
              ? 'Written now from the posts behind this link.'
              : 'Briefings are grounded in real posts, never invented.'}
        </p>
      </footer>
    </aside>
  )
}

/** Resting state: not a blank box — the strongest links, one click away. */
function EmptyPanel({ graph, onSelect }) {
  const labels = new Map((graph?.nodes ?? []).map((n) => [n.id, n.label]))
  const top = [...(graph?.edges ?? [])]
    .filter((e) => e.kind === 'co_mention')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)

  return (
    <aside className="flex h-full flex-col rounded-2xl border border-line bg-white px-6 py-6">
      <div
        aria-hidden="true"
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(colors.blue, 0.08) }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="6" cy="7" r="2.4" stroke={colors.blue} strokeWidth="1.5" />
          <circle cx="18" cy="6" r="2.4" stroke={colors.blue} strokeWidth="1.5" />
          <circle cx="12" cy="18" r="2.4" stroke={colors.blue} strokeWidth="1.5" />
          <path d="M7.9 8.6l3 7M16.5 8.1l-3.4 7.6M8.3 6.6h7.3" stroke={colors.blue} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="text-h4 font-semibold tracking-tight">Pick a connection</h2>
      <p className="mt-2 text-small font-light leading-relaxed text-muted">
        Click any entity or link on the map and this panel writes a briefing from the actual
        forum posts behind it — what the relationship is, why it matters, and the posts that
        prove it.
      </p>

      {top.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2.5 text-caption font-semibold uppercase tracking-[0.12em] text-muted">
            Strongest links
          </h3>
          <ul className="space-y-1.5">
            {top.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect?.({
                      type: 'edge',
                      edgeId: e.id,
                      keys: [e.source, e.target],
                      labels: {
                        [e.source]: labels.get(e.source) ?? e.source,
                        [e.target]: labels.get(e.target) ?? e.target,
                      },
                      edge: e,
                    })
                  }
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-blue hover:bg-mist"
                >
                  <span className="min-w-0 truncate text-small font-medium">
                    {labels.get(e.source)} <span className="font-light text-muted">+</span>{' '}
                    {labels.get(e.target)}
                  </span>
                  <span className="shrink-0 text-caption font-light tabular-nums text-muted">
                    {e.posts}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

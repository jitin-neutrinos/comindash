// Insights — live intelligence, not a list of conclusions.
//
// The old page showed what the nightly analyst concluded and stopped there.
// This one measures the corpus underneath each conclusion at request time and
// leads with the answer to the question a reader actually has: which of these
// is getting worse right now, and what should we do about it?
//
// Structure follows that question:
//   PressureStrip  — state of the whole board, filterable by momentum
//   Controls       — sort/filter, defaulting to "what's moving"
//   List + Panel   — scan rows, open one for a grounded AI briefing
//
// Auto-refresh keeps it live; `useApi`'s interval already pauses on a hidden
// tab, so an abandoned tab costs nothing.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getInsightIntel, useApi, relTime } from '../api'
import { colors, semantics, alpha } from '../theme'
import { usePageChoreo, gsap, prefersReducedMotion } from '../motion'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { InsightRowSkeleton } from '../components/Skeletons'
import PressureStrip from '../components/insights/PressureStrip'
import InsightRow from '../components/insights/InsightRow'
import BriefPanel from '../components/insights/BriefPanel'
import Pagination from '../components/Pagination'
import {
  MOMENTUM_RANK,
  SEVERITY_RANK,
  TYPE_LABEL,
  typeColor,
} from '../components/insights/vocab'

const REFRESH_MS = 120000
const PER_PAGE = 10

const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'pain_point', label: 'Pain points' },
  { key: 'trend', label: 'Trends' },
  { key: 'anomaly', label: 'Anomalies' },
  { key: 'relationship', label: 'Relationships' },
  { key: 'recommendation', label: 'Recommendations' },
]

const SORTS = [
  {
    key: 'momentum',
    label: "What's moving",
    // Default: momentum first. A high-severity conclusion nobody is posting
    // about is less actionable today than a medium one that is accelerating.
    cmp: (a, b) =>
      (MOMENTUM_RANK[a.momentum.state] ?? 9) - (MOMENTUM_RANK[b.momentum.state] ?? 9) ||
      b.momentum.recentPosts - a.momentum.recentPosts,
  },
  {
    key: 'severity',
    label: 'Severity',
    cmp: (a, b) =>
      (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
      b.scope.posts - a.scope.posts,
  },
  {
    key: 'reach',
    label: 'Reach',
    cmp: (a, b) => b.scope.posts - a.scope.posts,
  },
  {
    key: 'pain',
    label: 'Negativity',
    cmp: (a, b) => b.scope.negativeShare - a.scope.negativeShare,
  },
]

/** Sliding-pill tabs — same technique as the Sidebar's active indicator. */
function TypeTabs({ active, onChange, counts }) {
  const nav = useRef(null)
  const pill = useRef(null)
  const first = useRef(true)

  useEffect(() => {
    const container = nav.current
    const pillEl = pill.current
    if (!container || !pillEl) return
    const btn = container.querySelector(`[data-tab="${active}"]`)
    if (!btn) return
    const place = {
      autoAlpha: 1,
      x: btn.offsetLeft,
      y: btn.offsetTop,
      width: btn.offsetWidth,
      height: btn.offsetHeight,
    }
    if (first.current || prefersReducedMotion()) gsap.set(pillEl, place)
    else gsap.to(pillEl, { ...place, duration: 0.25, ease: 'power3.out' })
    first.current = false
  }, [active, counts])

  return (
    <div
      ref={nav}
      role="tablist"
      aria-label="Filter insights by type"
      className="relative flex flex-wrap gap-1 rounded-pill border border-line bg-surface p-1"
    >
      <div
        ref={pill}
        aria-hidden="true"
        className="absolute left-0 top-0 z-0 rounded-pill bg-blue"
        style={{ opacity: 0 }}
      />
      {TYPES.map((t) => {
        const isActive = active === t.key
        const count = counts[t.key] ?? 0
        if (t.key !== 'all' && count === 0) return null
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab={t.key}
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`relative z-10 rounded-pill px-3.5 py-1.5 text-small font-medium transition-colors ${
              isActive ? 'text-white' : 'text-muted hover:text-black'
            }`}
          >
            {t.label}
            {count > 0 && (
              <span className={`ml-1.5 tabular-nums ${isActive ? 'text-white/70' : 'text-muted/70'}`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function Insights() {
  const page = usePageChoreo([])
  const [type, setType] = useState('all')
  const [stateFilter, setStateFilter] = useState(null)
  const [sortKey, setSortKey] = useState('momentum')
  const [selected, setSelected] = useState(null)
  // `page` is taken by the choreography ref above, so the list page index is
  // named explicitly rather than shadowed.
  const [pageNum, setPageNum] = useState(1)

  const { data, loading, error } = useApi(getInsightIntel, {
    deps: [],
    intervalMs: REFRESH_MS,
  })

  const items = data?.items ?? []
  const rollup = data?.rollup

  const counts = useMemo(() => {
    const c = { all: items.length }
    for (const t of TYPES.slice(1)) c[t.key] = items.filter((i) => i.insightType === t.key).length
    return c
  }, [items])

  const visible = useMemo(() => {
    const sort = SORTS.find((s) => s.key === sortKey) ?? SORTS[0]
    return items
      .filter((i) => (type === 'all' ? true : i.insightType === type))
      .filter((i) => (stateFilter ? i.momentum.state === stateFilter : true))
      .slice()
      .sort(sort.cmp)
  }, [items, type, stateFilter, sortKey])

  const pageCount = Math.max(1, Math.ceil(visible.length / PER_PAGE))
  const paged = useMemo(
    () => visible.slice((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE),
    [visible, pageNum],
  )

  // Any change to filters or sort re-orders the list under the reader, so
  // page 4 of the old ordering is meaningless — go back to the top.
  useEffect(() => {
    setPageNum(1)
  }, [type, stateFilter, sortKey])

  // A refresh can shrink the list below the current page (an insight is
  // superseded, a filter now matches fewer). Clamp rather than render blank.
  useEffect(() => {
    if (pageNum > pageCount) setPageNum(pageCount)
  }, [pageNum, pageCount])

  // Keep the open panel honest: if a refresh or filter removes the selected
  // insight, close it rather than leaving a briefing for something no longer
  // on screen. Re-point at the fresh object so its numbers stay live.
  useEffect(() => {
    if (!selected) return
    const fresh = visible.find((i) => i.id === selected.id)
    if (!fresh) setSelected(null)
    else if (fresh !== selected) setSelected(fresh)
  }, [visible, selected])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={page} className="space-y-6">
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Insights</h1>
            <MetricInfo metricKey="insightsPage" />
          </div>
          <p className="mt-1 font-light text-muted">
            What the analyst concluded, measured against what the community is posting right now.
          </p>
        </div>
        {data?.generatedAt && (
          <p className="text-caption text-muted">
            Measured {relTime(data.generatedAt)} · refreshes every {REFRESH_MS / 60000} min
          </p>
        )}
      </header>

      {error && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-small font-medium text-salmon">Could not load live intelligence</p>
          <p className="mt-1 text-caption text-muted">{String(error.message ?? error)}</p>
        </div>
      )}

      {rollup && (
        <div data-anim="kpi">
          <PressureStrip
            rollup={rollup}
            stateFilter={stateFilter}
            onStateFilter={setStateFilter}
          />
        </div>
      )}

      <div data-anim="row" className="flex flex-wrap items-center justify-between gap-3">
        <TypeTabs active={type} onChange={setType} counts={counts} />
        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface p-1 sm:rounded-pill">
          <span className="px-2 text-caption text-muted">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSortKey(s.key)}
              aria-pressed={sortKey === s.key}
              className="rounded-pill px-3 py-1 text-small font-medium transition-colors"
              style={
                sortKey === s.key
                  ? { backgroundColor: alpha(colors.blue, 0.12), color: colors.blue }
                  : undefined
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {stateFilter && (
        <div data-anim="row" className="flex items-center gap-2">
          <PillTag>Showing {stateFilter} only</PillTag>
          <button
            type="button"
            onClick={() => setStateFilter(null)}
            className="text-caption font-medium text-blue hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className={selected ? 'space-y-4 xl:col-span-3' : 'space-y-4 xl:col-span-5'}>
          {loading && !data ? (
            Array.from({ length: 4 }).map((_, i) => <InsightRowSkeleton key={i} variant={i} />)
          ) : paged.length ? (
            <>
              {paged.map((item, idx) => (
                <div key={item.id} data-anim="row">
                  <InsightRow
                    item={item}
                    // Global rank, not page-local — "3." must mean the third
                    // most urgent insight, not the third row on page 2.
                    index={(pageNum - 1) * PER_PAGE + idx}
                    selected={selected?.id === item.id}
                    onSelect={(i) => setSelected(selected?.id === i.id ? null : i)}
                  />
                </div>
              ))}
              <Pagination
                page={pageNum}
                pageCount={pageCount}
                onChange={setPageNum}
                total={visible.length}
                perPage={PER_PAGE}
                label="insights"
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface py-16">
              <PillTag>
                No {stateFilter ? `${stateFilter} ` : ''}
                {type === 'all' ? '' : `${TYPE_LABEL(type)} `}insights
              </PillTag>
              {(stateFilter || type !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setStateFilter(null)
                    setType('all')
                  }}
                  className="text-small font-medium text-blue hover:underline"
                >
                  Show everything
                </button>
              )}
            </div>
          )}
        </div>

        {selected && (
          <aside className="xl:col-span-2">
            <div className="xl:sticky xl:top-6">
              <BriefPanel item={selected} onClose={() => setSelected(null)} />
            </div>
          </aside>
        )}
      </div>

      {!selected && visible.length > 0 && (
        <p className="text-center text-caption text-muted">
          Select an insight for a briefing grounded in its current posts.
        </p>
      )}
    </div>
  )
}

// Explorer — browse what the community actually said.
//
// The old page was a spreadsheet: a 6-column topics grid and a posts table
// whose "Post" column always read "Post #1" (the topic title was never sent),
// with no link anywhere. Nothing here was clickable, so the one thing a reader
// always wants — go read the actual thread — was impossible.
//
// This is a reading surface. Posts are rows you can scan and click through to
// Discourse; topics are rows that lead to their thread. Filters are the ones
// the backend can genuinely answer (priority, sentiment, sort), so no control
// on this page is decorative.

import { useMemo, useState } from 'react'
import {
  getPosts,
  getTopics,
  postUrl,
  topicUrl,
  useApi,
  formatDate,
  API_BASE,
} from '../api'
import { colors, semantics } from '../theme'
import { usePageChoreo } from '../motion'
import MetricInfo from '../components/MetricInfo'
import Pagination from '../components/Pagination'
import { RowsSkeleton } from '../components/Skeletons'

const PER_PAGE = 20

const TABS = [
  { key: 'posts', label: 'Posts', blurb: 'Individual messages, newest first.' },
  { key: 'topics', label: 'Topics', blurb: 'Threads, by most recent activity.' },
]

// Only filters the API can actually apply. A control that silently does
// nothing is worse than no control.
const PRIORITY_FILTERS = [
  { key: '', label: 'Any priority' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
]
const SENTIMENT_FILTERS = [
  { key: '', label: 'Any sentiment' },
  { key: 'neg', label: 'Negative' },
  { key: 'neu', label: 'Neutral' },
  { key: 'pos', label: 'Positive' },
]

const SENTIMENT_WORD = { pos: 'positive', neu: 'neutral', neg: 'negative' }

/** Author hashes are opaque; show a short, stable stub rather than 16 hex chars. */
const authorStub = (hash) => (hash ? `#${String(hash).slice(0, 6)}` : 'unknown')

const Badge = ({ color, children, title }) => (
  <span
    className="inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-caption font-medium"
    style={{ background: `${color}1f`, color: colors.black }}
    title={title}
  >
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />
    {children}
  </span>
)

/** One post, as a row you can read and click. */
const PostRow = ({ p }) => {
  const href = postUrl(p)
  const Row = href ? 'a' : 'div'
  const rowProps = href ? { href, target: '_blank', rel: 'noreferrer' } : {}

  return (
    <li>
      <Row
        {...rowProps}
        className={`group block min-w-0 border-b border-hairline px-4 py-4 transition-colors sm:px-5 ${
          href ? 'hover:bg-mist/50' : ''
        }`}
      >
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-body font-semibold group-hover:text-blue">
            {p.topicTitle || `Post #${p.postNumber}`}
          </h3>
          <span className="shrink-0 text-caption tabular-nums text-muted">
            {p.createdAt ? formatDate(p.createdAt) : ''}
          </span>
        </div>

        {p.excerpt ? (
          <p className="mt-1.5 line-clamp-2 text-small font-light leading-relaxed text-muted">
            {p.excerpt}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {p.priority ? (
            <Badge
              color={semantics.priority[p.priority.value] ?? colors.mist}
              title={`${Math.round(p.priority.confidence * 100)}% confidence`}
            >
              {p.priority.value} priority
            </Badge>
          ) : null}
          {p.sentiment ? (
            <Badge
              color={semantics.sentiment[p.sentiment.value] ?? colors.mist}
              title={`intensity ${p.sentiment.intensity.toFixed(2)}`}
            >
              {SENTIMENT_WORD[p.sentiment.value] ?? p.sentiment.value}
            </Badge>
          ) : null}
          <span className="text-caption text-muted">
            reply {p.postNumber} · author {authorStub(p.author)}
          </span>
          {href ? (
            <span className="ml-auto shrink-0 text-caption font-medium text-blue opacity-0 transition-opacity group-hover:opacity-100">
              Read on Discourse →
            </span>
          ) : null}
        </div>
      </Row>
    </li>
  )
}

/** One thread. Counts are secondary to the title, so they sit under it. */
const TopicRow = ({ t }) => {
  const href = topicUrl(t)
  const Row = href ? 'a' : 'div'
  const rowProps = href ? { href, target: '_blank', rel: 'noreferrer' } : {}

  return (
    <li>
      <Row
        {...rowProps}
        className={`group block min-w-0 border-b border-hairline px-4 py-4 transition-colors sm:px-5 ${
          href ? 'hover:bg-mist/50' : ''
        }`}
      >
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-body font-semibold group-hover:text-blue">
            {t.title || 'Untitled topic'}
          </h3>
          <span className="shrink-0 text-caption tabular-nums text-muted">
            {t.lastPostedAt ? formatDate(t.lastPostedAt) : ''}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
          {t.category ? (
            <span className="rounded-pill bg-mist px-2 py-0.5 font-medium text-ink">
              {t.category}
            </span>
          ) : null}
          <span className="tabular-nums">
            {t.postsCount.toLocaleString()} {t.postsCount === 1 ? 'post' : 'posts'}
          </span>
          <span className="tabular-nums">
            {t.views.toLocaleString()} {t.views === 1 ? 'view' : 'views'}
          </span>
          <span className="tabular-nums">
            {t.likeCount.toLocaleString()} {t.likeCount === 1 ? 'like' : 'likes'}
          </span>
          {href ? (
            <span className="ml-auto shrink-0 font-medium text-blue opacity-0 transition-opacity group-hover:opacity-100">
              Open thread →
            </span>
          ) : null}
        </div>
      </Row>
    </li>
  )
}

const Select = ({ value, onChange, options, label }) => (
  <label className="inline-flex items-center gap-2">
    <span className="sr-only">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-pill border border-line bg-surface px-3 py-1.5 text-small font-light text-ink focus:border-blue focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  </label>
)

export default function DataExplorer() {
  const root = usePageChoreo([])
  const [tab, setTab] = useState('posts')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [priority, setPriority] = useState('')
  const [sentiment, setSentiment] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)

  const isPosts = tab === 'posts'

  // Filters only exist for posts; sending them on the topics call would be a
  // silent no-op that makes the UI look broken when results don't change.
  const params = useMemo(
    () =>
      isPosts
        ? { page, perPage: PER_PAGE, search: query, priority, sentiment, sort }
        : { page, perPage: PER_PAGE, search: query },
    [isPosts, page, query, priority, sentiment, sort],
  )

  // Tag each payload with the tab that produced it. `tab` flips instantly but
  // the fetch resolves a render later, so without this the page briefly tries
  // to render posts as topic rows — and topic rows read `postsCount`/`views`,
  // which posts don't have. Same guard the Metrics page uses for its tabs.
  const { data, loading, error } = useApi(
    () => (isPosts ? getPosts : getTopics)(params).then((d) => ({ ...d, tab })),
    { deps: [isPosts, page, query, priority, sentiment, sort] },
  )
  const ready = data?.tab === tab ? data : null
  const settling = loading || !ready

  const items = ready?.items ?? []
  const total = ready?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  const reset = (fn) => (v) => {
    fn(v)
    setPage(1)
  }

  const switchTab = (key) => {
    setTab(key)
    setPage(1)
    // Post-only filters would keep narrowing an invisible query on Topics.
    setPriority('')
    setSentiment('')
  }

  const filtered = Boolean(query || priority || sentiment)
  const tabMeta = TABS.find((t) => t.key === tab)

  return (
    <div ref={root} className="space-y-6">
      <header data-anim="header">
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Explorer</h1>
          <MetricInfo metricKey="explorerPage" />
        </div>
        <p className="mt-1 font-light text-muted">
          Every ingested post and thread, with its AI analysis. Click any row to read it on
          Discourse.
        </p>
      </header>

      <div data-anim="row" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface p-1 sm:rounded-pill"
            role="tablist"
            aria-label="Dataset"
          >
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => switchTab(t.key)}
                className={`rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
                  tab === t.key ? 'bg-blue text-white' : 'text-muted hover:text-blue'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <a
            href={`${API_BASE}/export.csv?dataset=${tab}`}
            className="rounded-pill border border-line bg-surface px-4 py-1.5 text-small font-medium text-blue transition-colors hover:bg-mist"
          >
            Export CSV
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(search)
              setPage(1)
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isPosts ? 'Search posts and thread titles' : 'Search topics'}
              aria-label="Search"
              className="min-w-0 flex-1 rounded-pill border border-line bg-surface px-4 py-1.5 text-small font-light focus:border-blue focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-pill bg-blue px-4 py-1.5 text-small font-medium text-white"
            >
              Search
            </button>
          </form>

          {isPosts ? (
            <>
              <Select
                value={priority}
                onChange={reset(setPriority)}
                options={PRIORITY_FILTERS}
                label="Filter by priority"
              />
              <Select
                value={sentiment}
                onChange={reset(setSentiment)}
                options={SENTIMENT_FILTERS}
                label="Filter by sentiment"
              />
              <Select
                value={sort}
                onChange={reset(setSort)}
                options={[
                  { key: 'newest', label: 'Newest first' },
                  { key: 'oldest', label: 'Oldest first' },
                ]}
                label="Sort order"
              />
            </>
          ) : null}

          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setQuery('')
                setPriority('')
                setSentiment('')
                setPage(1)
              }}
              className="rounded-pill px-3 py-1.5 text-small font-medium text-muted transition-colors hover:text-blue"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <section
        data-anim="chart"
        className="overflow-hidden rounded-2xl border border-line bg-surface"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-h5 font-semibold">{tabMeta?.label}</h2>
          <p className="text-caption text-muted">
            {settling
              ? 'Loading…'
              : total
                ? `${total.toLocaleString()} ${filtered ? 'matching' : 'total'}`
                : tabMeta?.blurb}
          </p>
        </div>

        {settling ? (
          <div className="p-5">
            <RowsSkeleton rows={6} />
          </div>
        ) : error ? (
          <p className="px-5 py-10 text-center text-small text-muted">
            Couldn&rsquo;t load this list ({String(error.message || error)}).
          </p>
        ) : items.length ? (
          <ul>
            {isPosts
              ? items.map((p) => <PostRow key={p.id} p={p} />)
              : items.map((t) => <TopicRow key={t.id} t={t} />)}
          </ul>
        ) : (
          <div className="px-5 py-12 text-center">
            <p className="text-small text-muted">
              {filtered
                ? 'Nothing matches those filters.'
                : 'No data has been ingested yet.'}
            </p>
          </div>
        )}

        {pageCount > 1 ? (
          <div className="px-4 pb-4 pt-1 sm:px-5">
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
              total={total}
              perPage={PER_PAGE}
              label={isPosts ? 'posts' : 'topics'}
            />
          </div>
        ) : null}
      </section>
    </div>
  )
}

import { useState } from 'react'
import { getPosts, getTopics, useApi, formatDate, API_BASE } from '../api'
import { semantics } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { TableSkeleton } from '../components/Skeletons'

const PER_PAGE = 20
const TABS = [
  { key: 'topics', label: 'Topics' },
  { key: 'posts', label: 'Posts' },
]

export default function DataExplorer() {
  const root = usePageChoreo([])
  const [tab, setTab] = useState('topics')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useApi(
    () => (tab === 'topics' ? getTopics : getPosts)({ page, perPage: PER_PAGE, search: query }),
    { deps: [tab, page, query] },
  )

  const isTopics = tab === 'topics'
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE))

  const pill = (active) =>
    `rounded-pill px-4 py-1.5 text-small font-medium transition-colors ${
      active ? 'bg-blue text-white' : 'bg-white text-black/70 hover:text-blue'
    }`

  return (
    <div ref={root} className="space-y-6">
      <header data-anim="header">
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Data explorer</h1>
          <MetricInfo metricKey="explorerPage" />
        </div>
        <p className="mt-1 font-light text-muted">
          Browse ingested topics and posts with per-post AI analysis badges.
        </p>
      </header>

      <div data-anim="row" className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2" role="tablist" aria-label="Dataset">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={pill(tab === t.key)}
              onClick={() => {
                setTab(t.key)
                setPage(1)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form
            className="flex items-center gap-2"
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
              placeholder={isTopics ? 'Search topics' : 'Search posts'}
              aria-label="Search"
              className="w-48 rounded-pill border border-line bg-white px-4 py-1.5 text-small font-light focus:border-blue focus:outline-none sm:w-64"
            />
            <button type="submit" className="rounded-pill bg-blue px-4 py-1.5 text-small font-medium text-white">
              Search
            </button>
          </form>
          <a
            href={`${API_BASE}/export.csv?dataset=${tab}`}
            className="rounded-pill bg-white px-4 py-1.5 text-small font-medium text-blue hover:text-black"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div data-anim="chart">
        <FrameCard
          title={isTopics ? 'Topics' : 'Posts'}
          accent={semantics.priority.medium}
          lift={false}
          infoKey={isTopics ? 'topicsTable' : 'postsTable'}
        >
          {loading ? (
            <TableSkeleton />
          ) : error ? (
            <div className="flex items-center justify-center py-10">
              <PillTag color={semantics.severity.high} dot>
                Couldn't load data
              </PillTag>
            </div>
          ) : items.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-small">
                {isTopics ? (
                  <>
                    <thead>
                      <tr className="text-caption font-medium uppercase tracking-wider text-muted">
                        <th className="py-2 pr-4">Topic</th>
                        <th className="py-2 pr-4">Category</th>
                        <th className="py-2 pr-4 text-right">Posts</th>
                        <th className="py-2 pr-4 text-right">Views</th>
                        <th className="py-2 pr-4 text-right">Likes</th>
                        <th className="py-2">Last activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((t) => (
                        <tr key={t.id} className="border-t border-hairline align-top">
                          <td className="py-2.5 pr-4 font-medium">{t.title}</td>
                          <td className="py-2.5 pr-4 font-light">{t.category}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{t.postsCount}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{t.views}</td>
                          <td className="py-2.5 pr-4 text-right tabular-nums">{t.likeCount}</td>
                          <td className="py-2.5 font-light text-muted">
                            {t.lastPostedAt ? formatDate(t.lastPostedAt) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr className="text-caption font-medium uppercase tracking-wider text-muted">
                        <th className="py-2 pr-4">Post</th>
                        <th className="py-2 pr-4">Priority</th>
                        <th className="py-2">Sentiment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <tr key={p.id} className="border-t border-hairline align-top">
                          <td className="max-w-lg py-2.5 pr-4">
                            <p className="font-medium">{p.topicTitle || `Post #${p.postNumber}`}</p>
                            <p className="mt-0.5 line-clamp-2 font-light text-muted">{p.excerpt}</p>
                            <p className="mt-0.5 text-caption font-light text-muted">
                              {p.author} {p.createdAt ? `— ${formatDate(p.createdAt)}` : ''}
                            </p>
                          </td>
                          <td className="py-2.5 pr-4">
                            {p.priority ? (
                              <div className="flex flex-col items-start gap-1">
                                <PillTag color={semantics.priority[p.priority.value] ?? semantics.run.pending} dot>
                                  {p.priority.value}
                                </PillTag>
                                <span className="text-caption font-light text-muted">
                                  {Math.round(p.priority.confidence * 100)}% confidence
                                </span>
                              </div>
                            ) : (
                              <span className="font-light text-muted">—</span>
                            )}
                          </td>
                          <td className="py-2.5">
                            {p.sentiment ? (
                              <div className="flex flex-col items-start gap-1">
                                <PillTag color={semantics.sentiment[p.sentiment.value] ?? semantics.run.pending} dot>
                                  {p.sentiment.value}
                                </PillTag>
                                <span className="text-caption font-light text-muted">
                                  intensity {p.sentiment.intensity.toFixed(2)}
                                </span>
                              </div>
                            ) : (
                              <span className="font-light text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-10">
              <PillTag>No data yet</PillTag>
            </div>
          )}

          <footer className="mt-4 flex items-center justify-between gap-3">
            <p className="text-caption font-light text-muted">
              {total ? `Page ${data.page} of ${lastPage} — ${total.toLocaleString()} items` : ''}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-pill bg-white px-4 py-1.5 text-small font-medium text-blue disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= lastPage || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-pill bg-white px-4 py-1.5 text-small font-medium text-blue disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </footer>
        </FrameCard>
      </div>
    </div>
  )
}

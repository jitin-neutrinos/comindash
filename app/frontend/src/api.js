import { useEffect, useState } from 'react'
import { insightSlug } from './slug'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
export { BASE as API_BASE }

async function req(path, { query, ...options } = {}) {
  // Drop empty params instead of sending `?priority=`: FastAPI validates an
  // empty string against the enum and 422s, so "no filter" must mean "no
  // parameter". Doing it here keeps every caller from re-deriving the rule.
  const clean = Object.fromEntries(
    Object.entries(query ?? {}).filter(
      ([, v]) => v !== '' && v !== null && v !== undefined,
    ),
  )
  const qs = Object.keys(clean).length ? `?${new URLSearchParams(clean)}` : ''
  const res = await fetch(`${BASE}${path}${qs}`, {
    headers: { Accept: 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // FastAPI validation errors arrive as an array of objects; stringifying
    // that yields "[object Object]" and tells the reader nothing.
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d) => d.msg ?? JSON.stringify(d)).join('; ')
      : body.detail
    throw new Error(detail || `Request to ${path} failed (${res.status})`)
  }
  return res.json()
}

/* ---- normalizers: the only place backend field names are known ------------- */
const num = (v, d = 0) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d)
const list = (v) => (Array.isArray(v) ? v : [])
// Null/undefined become '' so a missing string field renders as empty rather
// than the literal "null"/"undefined".
const str = (v, d = '') => (v === null || v === undefined ? d : String(v))

const health = (d) => ({
  status: d.status ?? 'unknown',
  db: d.db ?? 'unknown',
  scheduler: d.scheduler ?? false,
  lastRun: d.last_run ?? d.lastRun ?? {},
})

const overview = (d) => {
  const ph = d.pipeline_health ?? d.pipelineHealth
  // pipeline_health arrives as {ingest: {...}, analyze: {...}} run objects —
  // derive a single display status: healthy iff every stage is done.
  let pipelineHealth = 'unknown'
  if (typeof ph === 'string') {
    pipelineHealth = ph
  } else if (ph && typeof ph === 'object') {
    const stages = Object.values(ph)
    pipelineHealth =
      stages.length > 0 && stages.every((st) => st && st.status === 'done')
        ? 'healthy'
        : stages.some((st) => st && st.status === 'failed')
          ? 'degraded'
          : 'running'
  }
  return {
  totalPosts: num(d.total_posts ?? d.totalPosts),
  totalTopics: num(d.total_topics ?? d.totalTopics),
  avgSentiment: num(d.avg_sentiment ?? d.avgSentiment),
  highPriorityCount: num(d.high_priority_count ?? d.highPriorityCount),
  activePainPoints: num(d.active_pain_points ?? d.activePainPoints),
  modelConfidence: num(d.model_confidence ?? d.modelConfidence),
  pipelineHealth,
  // Period-over-period movement, measured server-side (routes/overview.py).
  // `pct: null` means there was no baseline to divide by — the UI must show
  // the raw change rather than invent a percentage.
  deltas: d.deltas && typeof d.deltas === 'object' ? d.deltas : {},
  lastPostAt: d.last_post_at ?? null,
  generatedAt: d.generated_at ?? d.last_updated ?? null,
  }
}

const insightCard = (i) => ({
  id: i.id,
  // Canonical URL segment from the server. Falls back to a local derivation
  // only for payloads that predate the slug field.
  slug: i.slug || insightSlug(i.id, i.title ?? ''),
  title: i.title ?? 'Untitled insight',
  body: i.body ?? '',
  severity: i.severity ?? 'medium',
  status: i.status ?? 'active',
  insightType: i.insight_type ?? 'pain_point',
  evidenceCount: num(i.evidence_count ?? (i.evidence ? i.evidence.length : null)),
  createdAt: i.created_at ?? null,
})

const insightDetail = (d) => ({
  ...insightCard(d),
  evidence: list(d.evidence).map((e) => ({
    postId: e.post_id ?? e.discourse_post_id,
    quote: e.quote ?? '',
    relevanceNote: e.relevance_note ?? '',
    url: e.url ?? null,
  })),
  relationships: list(d.relationships).map((r) => ({
    subject: `${r.subject_type ?? 'entity'} — ${r.subject_value ?? '?'}`,
    relation: r.relation ?? 'relates to',
    object: `${r.object_type ?? 'entity'} — ${r.object_value ?? '?'}`,
    strength: num(r.strength, 0.5),
  })),
})

// Backend shape (routes/trends.py): {date, value, extra}. For metric=priority
// the per-class counts are in `extra`; for metric=entity the label is packed
// into `date` as "LABEL:text" and there is no calendar date at all.
const trendPoint = (p, idx) => {
  const extra = p.extra ?? {}
  const raw = p.date ?? p.day ?? String(idx + 1)
  const entityMatch = typeof raw === 'string' ? raw.match(/^([A-Z_]+):(.*)$/) : null
  return {
    date: raw,
    label: entityMatch ? entityMatch[2] : (p.entity ?? p.name ?? p.label ?? ''),
    entityLabel: entityMatch ? entityMatch[1] : '',
    count: num(extra.count ?? p.count ?? p.posts ?? p.value),
    high: num(extra.high ?? p.high),
    medium: num(extra.medium ?? p.medium),
    low: num(extra.low ?? p.low),
    pos: num(extra.pos ?? p.pos ?? p.positive),
    neu: num(extra.neu ?? p.neu ?? p.neutral),
    neg: num(extra.neg ?? p.neg ?? p.negative),
    avg: num(p.value ?? p.avg ?? p.avg_sentiment ?? p.score),
  }
}

// Backend returns {items, total, limit, offset}; the UI thinks in pages.
const paginate = (d) => {
  const limit = num(d.limit ?? d.per_page ?? d.perPage, 20) || 20
  const offset = num(d.offset)
  return {
    items: list(d.items ?? d.results ?? d),
    total: num(d.total),
    page: Math.floor(offset / limit) + 1,
    perPage: limit,
  }
}

/** {page, perPage, search} (UI) -> {limit, offset, q} (API). */
const pageQuery = ({ page = 1, perPage = 20, search = '', ...rest } = {}) => {
  const q = { limit: perPage, offset: Math.max(0, (page - 1) * perPage), ...rest }
  if (search) q.q = search
  return q
}

const topic = (t) => ({
  id: t.id,
  discourseTopicId: t.discourse_topic_id ?? t.discourseTopicId ?? null,
  slug: t.slug ?? '',
  title: t.title ?? '',
  category: t.category ?? '',
  postsCount: num(t.posts_count ?? t.postsCount),
  views: num(t.views),
  likeCount: num(t.like_count ?? t.likeCount),
  lastPostedAt: t.last_posted_at ?? t.lastPostedAt ?? null,
})

// routes/posts.py returns an `excerpt` (not the full body — release-note posts
// run to 12KB+), topic context for linking, and nested analysis badges:
// {..., analysis: {priority, priority_confidence, sentiment, ...}}
const post = (p) => {
  const a = p.analysis ?? {}
  return {
    id: p.id,
    discoursePostId: p.discourse_post_id ?? p.discoursePostId ?? null,
    topicId: p.topic_id ?? p.topicId ?? null,
    topicTitle: p.topic_title ?? p.topicTitle ?? '',
    topicSlug: p.topic_slug ?? p.topicSlug ?? '',
    topicDiscourseId: p.topic_discourse_id ?? p.topicDiscourseId ?? null,
    postNumber: num(p.post_number ?? p.postNumber),
    author: p.author_hash ?? p.authorHash ?? 'anonymous',
    excerpt: str(p.excerpt),
    createdAt: p.created_at ?? null,
    modelVersion: a.model_version ?? null,
    priority: a.priority
      ? { value: a.priority, confidence: num(a.priority_confidence) }
      : null,
    sentiment: a.sentiment
      ? { value: a.sentiment, intensity: num(a.sentiment_intensity) }
      : null,
  }
}

/**
 * Canonical Discourse URL for a post. Built in one place so no page has to
 * reassemble it from parts and get the shape subtly wrong.
 */
export const postUrl = (p) =>
  p?.topicDiscourseId
    ? `https://community.neutrinos.com/t/${p.topicSlug || 'topic'}/${p.topicDiscourseId}/${p.discoursePostId ?? ''}`.replace(/\/$/, '')
    : null

export const topicUrl = (t) =>
  t?.discourseTopicId
    ? `https://community.neutrinos.com/t/${t.slug || 'topic'}/${t.discourseTopicId}`
    : null

// routes/pipeline.py rows: {id, kind, status, started_at, finished_at, stats,
// error, triggered_by}. The `stats` blob differs per kind (ingest = flat
// counters, analyze = nested per-stage blobs, assistant = insight counters),
// so lift only the numbers a run row displays, defaulting on absent keys.
const run = (r) => {
  const s = r.stats && typeof r.stats === 'object' ? r.stats : {}
  return {
    id: r.id,
    kind: r.kind ?? 'ingest',
    status: r.status ?? 'pending',
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    triggeredBy: r.triggered_by ?? null,
    error: r.error ?? null,
    mode: s.mode ?? null,
    postsNew: num(s.posts_new),
    postsUpdated: num(s.posts_updated),
    topicsFetched: num(s.topics_fetched),
    postsAnalyzed: num(s.priority?.posts ?? s.sentiment?.posts ?? s.extraction?.analysed),
    entitiesFound: num(s.extraction?.entities),
    modelVersion: s.priority?.mode ?? s.sentiment?.mode ?? s.extraction?.mode ?? null,
    insightsAccepted: num(s.insights_accepted),
    insightsRejected: num(s.insights_rejected),
    assistantVersion: s.assistant_version ?? null,
  }
}

/* ---- endpoints (SPEC.md API contract) -------------------------------------- */
export const getHealth = () => req('/health').then(health)
export const getOverview = () => req('/overview').then(overview)
export const getInsights = ({ insightType, status = 'active' } = {}) =>
  req('/insights', { query: { ...(insightType ? { insight_type: insightType } : {}), status, limit: 200 } }).then(
    (d) => list(d.items ?? d.insights ?? d).map(insightCard),
  )
/**
 * Fetch one insight by ref — either a numeric id or a `<slug>-<id>` segment.
 * The backend resolves both, and returns the canonical `slug` so the caller
 * can correct the URL when an old or hand-typed link was used.
 */
export const getInsight = (ref) =>
  req(`/insights/${encodeURIComponent(ref)}`).then(insightDetail)

/**
 * Claim verification (services/claim_check.py).
 *
 * The assistant asserts relationships; this endpoint re-checks each one against
 * the corpus on every request. `verdict` is the measurement, `assertedConfidence`
 * is the model's own opinion — they are deliberately separate fields so the UI
 * can never present an opinion as a measurement.
 */
const claimEndpoint = (e) => ({
  label: str(e?.label, 'unknown'),
  kind: str(e?.kind, 'concept'),
  raw: str(e?.raw),
  posts: num(e?.posts),
  matchedOn: str(e?.matched_on),
  resolved: Boolean(e?.resolved),
})

const claimEvidence = (p) => ({
  postId: p.post_id,
  discoursePostId: p.discourse_post_id,
  topic: str(p.topic),
  slug: str(p.slug),
  topicId: p.topic_id,
  createdAt: p.created_at ?? null,
  excerpt: str(p.excerpt),
})

const claim = (c) => ({
  id: c.id,
  subject: claimEndpoint(c.subject),
  object: claimEndpoint(c.object),
  relation: str(c.relation, 'is related to'),
  relationToken: str(c.relation_token),
  verdict: str(c.verdict, 'unverifiable'),
  coOccurringPosts: num(c.co_occurring_posts),
  subjectPosts: num(c.subject_posts),
  objectPosts: num(c.object_posts),
  expectedByChance: num(c.expected_by_chance),
  lift: c.lift === null || c.lift === undefined ? null : num(c.lift),
  assertedConfidence: num(c.asserted_confidence),
  evidence: list(c.evidence).map(claimEvidence),
})

export const getInsightClaims = (ref) =>
  req(`/insights/${encodeURIComponent(ref)}/claims`).then((d) => ({
    insightId: d.insight_id,
    corpusPosts: num(d.corpus_posts),
    claims: list(d.claims).map(claim),
    summary: {
      total: num(d.summary?.total),
      supported: num(d.summary?.supported),
      thin: num(d.summary?.thin),
      unsupported: num(d.summary?.unsupported),
      unverifiable: num(d.summary?.unverifiable),
    },
  }))

/**
 * Knowledge graph (routes/relationships.py, view=graph). Two edge kinds:
 * `co_mention` (measured from extractions) and `asserted` (nightly analyst).
 * Edges referencing a dropped node are filtered here so the layout never has
 * to defend against dangling endpoints.
 */
export const getRelationshipGraph = ({ minEdge = 2, maxPeople = 28 } = {}) =>
  req('/relationships', { query: { view: 'graph', min_edge: minEdge, max_people: maxPeople } }).then(
    (d) => {
      const nodes = list(d.nodes).map((n) => ({
        id: String(n.id),
        label: n.label ?? String(n.id),
        kind: n.kind ?? 'concept',
        weight: num(n.weight, 1),
        degree: num(n.degree, 0),
        description: n.description ?? '',
        meta: n.meta && typeof n.meta === 'object' ? n.meta : {},
      }))
      const ids = new Set(nodes.map((n) => n.id))
      const edges = list(d.edges)
        .filter((e) => ids.has(String(e.source)) && ids.has(String(e.target)))
        .map((e) => ({
          id: String(e.id),
          source: String(e.source),
          target: String(e.target),
          kind: e.kind ?? 'co_mention',
          weight: num(e.weight, 1),
          posts: num(e.posts, 0),
          relation: e.relation ?? '',
          insight_id: e.insight_id ?? null,
        }))
      const s = d.stats && typeof d.stats === 'object' ? d.stats : {}
      return {
        nodes,
        edges,
        stats: {
          people: num(s.people),
          products: num(s.products),
          concepts: num(s.concepts),
          coMentionEdges: num(s.co_mention_edges),
          assertedEdges: num(s.asserted_edges),
        },
      }
    },
  )

/** AI briefing for one node or edge. POST because the selection is the query. */
export const getRelationshipBrief = ({ keys, labels = {}, stats = {}, refresh = false }) =>
  req('/relationships/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ keys, labels, stats, refresh }),
  })

/**
 * Live intelligence for the Insights page (services/insight_intel.py).
 *
 * Every field here is MEASURED from the corpus at request time — scope size,
 * momentum against a baseline window, weekly series, lineage. That is the
 * difference between this and `getInsights`, which returns the analyst's
 * frozen conclusions. The page uses this one so the numbers are live.
 */
export const getInsightIntel = ({ days = 90 } = {}) =>
  req('/insights/intel', { query: { days } }).then((d) => {
    const r = d.rollup && typeof d.rollup === 'object' ? d.rollup : {}
    return {
      generatedAt: d.generated_at ?? null,
      windowDays: num(d.window_days, days),
      items: list(d.items).map((i) => {
        const s = i.scope && typeof i.scope === 'object' ? i.scope : {}
        const m = i.momentum && typeof i.momentum === 'object' ? i.momentum : {}
        const l = i.lineage && typeof i.lineage === 'object' ? i.lineage : {}
        return {
          id: i.id,
          slug: i.slug || insightSlug(i.id, i.title ?? ''),
          insightType: i.insight_type ?? 'pain_point',
          title: i.title ?? '',
          body: i.body ?? '',
          severity: i.severity ?? 'low',
          status: i.status ?? 'active',
          assistantVersion: i.assistant_version ?? '',
          createdAt: i.created_at ?? null,
          firstSeen: i.first_seen ?? null,
          evidenceCount: num(i.evidence_count, 0),
          subjects: list(i.subjects).map((x) => ({
            key: x.key ?? '',
            kind: x.kind ?? 'product',
            label: x.label ?? '',
            description: x.description ?? '',
            posts: num(x.posts, 0),
          })),
          scope: {
            posts: num(s.posts, 0),
            mode: s.mode ?? 'none',
            termNarrowed: Boolean(s.term_narrowed),
            postsInWindow: num(s.posts_in_window, 0),
            negativePosts: num(s.negative_posts, 0),
            highPriorityPosts: num(s.high_priority_posts, 0),
            negativeShare: num(s.negative_share, 0),
            corpusShare: num(s.corpus_share, 0),
            lastPost: s.last_post ?? null,
            // null is meaningful (no dated post in scope) — keep it null
            // rather than coercing to 0, which would read as "today".
            daysSinceLastPost:
              s.days_since_last_post === null || s.days_since_last_post === undefined
                ? null
                : num(s.days_since_last_post, 0),
          },
          momentum: {
            state: m.state ?? 'dormant',
            deltaPct: m.delta_pct === null || m.delta_pct === undefined ? null : num(m.delta_pct, 0),
            recentPosts: num(m.recent_posts, 0),
            baselinePosts: num(m.baseline_posts, 0),
            recentDays: num(m.recent_days, 14),
            baselineDays: num(m.baseline_days, 28),
          },
          series: list(i.series).map((p) => ({
            week: p.week ?? '',
            posts: num(p.posts, 0),
            negative: num(p.negative, 0),
            high: num(p.high, 0),
          })),
          lineage: {
            cycles: num(l.cycles, 1),
            severityChanged: Boolean(l.severity_changed),
            severityHistory: list(l.severity_history),
            firstSeen: l.first_seen ?? null,
          },
          relations: list(i.relations).map((x) => ({
            subject: x.subject ?? '',
            relation: x.relation ?? '',
            object: x.object ?? '',
          })),
          related: list(i.related).map((x) => ({
            id: x.id,
            title: x.title ?? '',
            insightType: x.insight_type ?? '',
            shared: list(x.shared),
          })),
        }
      }),
      rollup: {
        active: num(r.active, 0),
        byState: r.by_state && typeof r.by_state === 'object' ? r.by_state : {},
        byType: r.by_type && typeof r.by_type === 'object' ? r.by_type : {},
        bySeverity: r.by_severity && typeof r.by_severity === 'object' ? r.by_severity : {},
        coverage: num(r.coverage, 0),
        coveredPosts: num(r.covered_posts, 0),
        windowPosts: num(r.window_posts, 0),
        totalPosts: num(r.total_posts, 0),
        recentPosts: num(r.recent_posts, 0),
        recentNegative: num(r.recent_negative, 0),
        recentHigh: num(r.recent_high, 0),
        superseded: num(r.superseded, 0),
        recentDays: num(r.recent_days, 14),
        baselineDays: num(r.baseline_days, 28),
      },
    }
  })

/**
 * AI briefing for ONE insight, grounded in its current scope.
 * POST because generating the brief writes the cache row.
 * `mode` is 'glm' (model wrote it) or 'evidence' (measurement-only fallback) —
 * the UI must show which, never pass a fallback off as analysis.
 */
export const getInsightBrief = ({ id, ref, refresh = false, days = 90 }) =>
  req(`/insights/${encodeURIComponent(ref ?? id)}/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refresh, days }),
  }).then((d) => ({
    headline: d.headline ?? '',
    soWhat: d.so_what ?? '',
    actions: list(d.actions),
    drivers: list(d.drivers),
    watchOut: d.watch_out ?? '',
    confidence: d.confidence ?? 'low',
    mode: d.mode ?? 'evidence',
    reason: d.reason ?? '',
    cached: Boolean(d.cached),
    generatedAt: d.generated_at ?? null,
    posts: list(d.posts).map((p) => ({
      postId: p.post_id,
      discoursePostId: p.discourse_post_id ?? null,
      topic: p.topic ?? '',
      slug: p.slug ?? '',
      topicId: p.topic_id ?? null,
      createdAt: p.created_at ?? null,
      excerpt: p.excerpt ?? '',
      isEvidence: Boolean(p.is_evidence),
      negative: Boolean(p.negative),
      highPriority: Boolean(p.high_priority),
    })),
  }))

export const getRelationships = () =>
  req('/relationships', { query: { view: 'asserted' } }).then((d) => {
    const nodes = list(d.nodes).map((n, i) => ({
      id: n.id ?? i,
      type: n.type ?? 'entity',
      value: n.value ?? n.label ?? n.name ?? `Node ${i + 1}`,
      weight: num(n.weight ?? n.strength, 1),
    }))
    const byId = new Map(nodes.map((n) => [String(n.id), n]))
    const links = list(d.links ?? d.edges)
      .map((l) => {
        const source = byId.get(String(l.source)) ?? nodes[Number(l.source)]
        const target = byId.get(String(l.target)) ?? nodes[Number(l.target)]
        if (!source || !target) return null
        return {
          source,
          target,
          strength: num(l.strength, 0.5),
          relation: l.relation ?? 'relates to',
        }
      })
      .filter(Boolean)
    return { nodes, links }
  })

export const getTrends = (metric, days = 30) =>
  req('/trends', { query: { metric, days } }).then((d) =>
    list(d.points ?? d.series ?? d.items ?? d).map(trendPoint),
  )

/**
 * Live intelligence for one metric (services/metrics_intel.py).
 *
 * Everything here is MEASURED from the same rows the chart renders — anomalies
 * (robust median+MAD outliers), the change point, half-window movers and mix
 * drift. The shape varies by metric, so the normalizer keeps each metric's own
 * fields and only guarantees the envelope every caller depends on.
 */
// `num`, `str` and `list` are the file's existing coercers (top of file).
const maybeNum = (v) => (v === null || v === undefined ? null : num(v))

const anomaly = (a) => ({
  date: str(a?.date),
  value: num(a?.value),
  score: num(a?.score),
  direction: a?.direction === 'drop' ? 'drop' : 'spike',
  vsTypical: num(a?.vs_typical),
})

const mover = (m) => ({
  key: str(m?.key),
  label: str(m?.label ?? m?.key),
  category: str(m?.category),
  before: num(m?.before),
  after: num(m?.after),
  // null means "no baseline" (a new entity), NOT zero change — the UI must
  // say "new" rather than draw a 0% bar.
  change: maybeNum(m?.change),
  status: str(m?.status ?? 'changed'),
})

const driftBlock = (d) =>
  Object.fromEntries(
    Object.entries(d ?? {}).map(([k, v]) => [
      k,
      { before: num(v?.before), after: num(v?.after), delta: num(v?.delta) },
    ]),
  )

export const metricIntel = (d) => {
  const metric = str(d?.metric)
  const base = {
    metric,
    window: {
      days: num(d?.window?.days, 30),
      start: str(d?.window?.start),
      end: str(d?.window?.end),
    },
    generatedAt: str(d?.generated_at),
    anomalies: list(d?.anomalies).map(anomaly),
  }

  if (metric === 'volume') {
    return {
      ...base,
      series: list(d?.series).map((p) => ({ date: str(p?.date), value: num(p?.value) })),
      total: num(d?.total),
      dailyAvg: num(d?.daily_avg),
      peak: d?.peak ? { date: str(d.peak.date), value: num(d.peak.value) } : null,
      quietDays: num(d?.quiet_days),
      firstHalfRate: num(d?.first_half_rate),
      secondHalfRate: num(d?.second_half_rate),
      change: maybeNum(d?.change),
      changePoint: d?.change_point
        ? { index: num(d.change_point.index), date: str(d.change_point.date) }
        : null,
      weekday: list(d?.weekday).map((w) => ({ day: str(w?.day), avg: num(w?.avg) })),
      topTopics: list(d?.top_topics).map((t) => ({ label: str(t?.label), count: num(t?.count) })),
      topTopicShare: num(d?.top_topic_share),
      activeAuthors: num(d?.active_authors),
    }
  }

  if (metric === 'sentiment' || metric === 'priority') {
    const keys = metric === 'sentiment' ? ['pos', 'neu', 'neg'] : ['high', 'medium', 'low']
    return {
      ...base,
      keys,
      series: list(d?.series).map((p) => ({
        date: str(p?.date),
        total: num(p?.total),
        ...Object.fromEntries(keys.map((k) => [k, num(p?.[k])])),
      })),
      totals: Object.fromEntries(keys.map((k) => [k, num(d?.totals?.[k])])),
      shares: Object.fromEntries(keys.map((k) => [k, num(d?.shares?.[k])])),
      labelledPosts: num(d?.labelled_posts),
      drift: driftBlock(d?.drift),
      avgConfidence: num(d?.avg_confidence),
      worstDay: d?.worst_day
        ? { date: str(d.worst_day.date), negShare: num(d.worst_day.neg_share) }
        : null,
      hotTopics: list(d?.hot_topics).map((t) => ({ label: str(t?.label), count: num(t?.count) })),
    }
  }

  return {
    ...base,
    top: list(d?.top).map((t) => ({
      key: str(t?.key),
      label: str(t?.label),
      category: str(t?.category),
      count: num(t?.count),
      share: num(t?.share),
    })),
    byCategory: list(d?.by_category).map((c) => ({
      label: str(c?.label),
      count: num(c?.count),
      share: num(c?.share),
    })),
    risers: list(d?.risers).map(mover),
    fallers: list(d?.fallers).map(mover),
    distinctEntities: num(d?.distinct_entities),
    totalMentions: num(d?.total_mentions),
    productShare: num(d?.product_share),
  }
}

/** Grounded AI brief for one metric slice (services/metrics_brief.py). */
export const metricBrief = (d) => ({
  headline: str(d?.headline),
  assessment: str(d?.assessment),
  findings: list(d?.findings).map((f) => ({
    label: str(f?.label),
    detail: str(f?.detail),
  })),
  actions: list(d?.actions).map(str).filter(Boolean),
  watchOut: str(d?.watch_out),
  confidence: ['high', 'medium', 'low'].includes(d?.confidence) ? d.confidence : 'medium',
  // 'evidence' = measurement-only fallback. The UI must never dress this up
  // as AI analysis.
  mode: d?.mode === 'glm' ? 'glm' : 'evidence',
  reason: str(d?.reason),
  cached: Boolean(d?.cached),
  generatedAt: str(d?.generated_at),
})

export const getMetricIntel = (metric, days = 30) =>
  req('/metrics/intel', { query: { metric, days } }).then(metricIntel)

export const getMetricBrief = ({ metric, days = 30, refresh = false }) =>
  req(`/metrics/${encodeURIComponent(metric)}/brief`, {
    method: 'POST',
    body: JSON.stringify({ days, refresh }),
    headers: { 'Content-Type': 'application/json' },
  }).then(metricBrief)

export const getRuns = (query = {}) =>
  req('/runs', { query: pageQuery(query) }).then((d) => ({
    ...paginate(d),
    items: paginate(d).items.map(run),
  }))

export const getTopics = (query = {}) =>
  req('/topics', { query: pageQuery(query) }).then((d) => ({
    ...paginate(d),
    items: paginate(d).items.map(topic),
  }))
export const getPosts = (query = {}) =>
  req('/posts', { query: pageQuery(query) }).then((d) => ({
    ...paginate(d),
    items: paginate(d).items.map(post),
  }))

/* ---- threshold calibration wrapper (fix 1 — retrain-free) -------------------
   Per-class confidence thresholds tuned on holdout to lift minority recall.
   Default thresholds: {high: 0.50, medium: 0.55, low: 0.45}
   Sentiment: {pos: 0.45, neu: 0.55, neg: 0.50} */
export const CALIBRATION = { priority: { high: 0.50, medium: 0.55, low: 0.45 }, sentiment: { pos: 0.45, neu: 0.55, neg: 0.50 } }

/**
 * useApi(fn, { deps, intervalMs }) — loading/error/data plus optional polling.
 * Pass stable deps (the values fn closes over), not fn itself.
 */
export function useApi(fn, { deps = [], intervalMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: s.data === null, error: null }))
    fn().then(
      (data) => !cancelled && setState({ data, loading: false, error: null }),
      (error) => !cancelled && setState((s) => ({ ...s, loading: false, error })),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  useEffect(() => {
    if (!intervalMs) return undefined
    // Pause polling while the tab is hidden (db-hit audit: a forgotten open
    // tab polled health 24/7 — 2 pings/min per component).
    let id
    const start = () => {
      id = setInterval(() => {
        if (!document.hidden) setTick((t) => t + 1)
      }, intervalMs)
    }
    const stop = () => id && clearInterval(id)
    const onVis = () => {
      stop()
      if (!document.hidden) {
        setTick((t) => t + 1) // refresh immediately on return
        start()
      }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])

  return state
}

/* ---- review + system (model registry & command centre) --------------------- */

/** A number that may legitimately be absent. `num()` would coerce a missing
 *  metric to 0, which renders as a failing score — "not measured" must survive
 *  the normalizer. */
const maybe = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

const gitCommit = (c) => ({
  sha: str(c?.sha),
  short: str(c?.short) || str(c?.sha).slice(0, 8),
  author: str(c?.author),
  subject: str(c?.subject),
  committedAt: str(c?.committed_at),
})

const perClass = (pc) =>
  Object.entries(pc ?? {}).map(([label, m]) => ({
    label,
    precision: maybe(m?.precision),
    recall: maybe(m?.recall),
    f1: maybe(m?.f1),
    support: maybe(m?.support),
    correct: maybe(m?.correct),
  }))

const evaluation = (e) => ({
  id: num(e?.id),
  evalType: str(e?.eval_type),
  evalSetRef: str(e?.eval_set_ref),
  evalRows: maybe(e?.eval_rows),
  evaluatedAt: str(e?.evaluated_at),
  accuracy: maybe(e?.accuracy),
  macroF1: maybe(e?.macro_f1),
  perClass: perClass(e?.per_class),
  // {gold: {pred: count}} stays nested — the UI renders it as a matrix.
  confusion: e?.confusion && typeof e.confusion === 'object' ? e.confusion : {},
  isCurrent: Boolean(e?.is_current),
  gitCommit: str(e?.git_commit),
  docRef: str(e?.doc_ref),
  notes: str(e?.notes),
})

const trainingRun = (r) => ({
  id: num(r?.id),
  runType: str(r?.run_type),
  label: str(r?.label),
  startedAt: str(r?.started_at),
  finishedAt: str(r?.finished_at),
  durationHours: maybe(r?.duration_hours),
  epochs: maybe(r?.epochs),
  finalLoss: maybe(r?.final_loss),
  hardware: str(r?.hardware),
  datasetRef: str(r?.dataset_ref),
  dataset: r?.dataset && typeof r.dataset === 'object' ? r.dataset : {},
  hyperparams: r?.hyperparams && typeof r.hyperparams === 'object' ? r.hyperparams : {},
  outcome: str(r?.outcome),
  outcomeReason: str(r?.outcome_reason),
  gitCommit: str(r?.git_commit),
  gitSubject: str(r?.git_subject),
  gitCommittedAt: str(r?.git_committed_at),
  logPath: str(r?.log_path),
  docRef: str(r?.doc_ref),
  notes: str(r?.notes),
})

const liveStats = (s) =>
  s
    ? {
        rows: maybe(s.rows),
        postsScored: maybe(s.posts_scored),
        coverage: maybe(s.coverage),
        // Sorted desc so the UI never re-sorts and never shows an arbitrary order.
        distribution: Object.entries(s.distribution ?? {})
          .map(([label, count]) => ({ label, count: num(count) }))
          .sort((a, b) => b.count - a.count),
        confidenceBands: s.confidence_bands ?? null,
        meanConfidence: maybe(s.mean_confidence),
        rowsInWindow: maybe(s.rows_in_window),
        note: str(s.note),
      }
    : null

const reviewModel = (m) => ({
  id: num(m?.id),
  kind: str(m?.kind),
  version: str(m?.version),
  displayName: str(m?.display_name) || str(m?.version),
  task: str(m?.task),
  baseModel: str(m?.base_model),
  architecture: str(m?.architecture),
  paramCount: str(m?.param_count),
  checkpointPath: str(m?.checkpoint_path),
  servingVia: str(m?.serving_via),
  stage: str(m?.stage) || 'registered',
  provider: str(m?.provider),
  license: str(m?.license),
  provenanceUrl: str(m?.provenance_url),
  notes: str(m?.notes),
  active: Boolean(m?.active),
  trainedAt: str(m?.trained_at),
  deployedAt: str(m?.deployed_at),
  trainingSetRef: str(m?.training_set_ref),
  gitCommit: str(m?.git_commit),
  gitShort: str(m?.git_commit).slice(0, 8),
  gitSubject: str(m?.git_subject),
  gitAuthor: str(m?.git_author),
  gitCommittedAt: str(m?.git_committed_at),
  gitPaths: list(m?.git_paths).map(str),
  gitHistory: list(m?.git_history).map(gitCommit),
  hyperparams: m?.hyperparams && typeof m.hyperparams === 'object' ? m.hyperparams : {},
  calibration: m?.calibration && typeof m.calibration === 'object' ? m.calibration : {},
  labels: list(m?.labels).map(str),
  // headline names WHICH metric it is — a macro-F1 must never be captioned
  // "accuracy" just because one card template serves every model kind.
  headline: {
    value: maybe(m?.headline?.value),
    label: str(m?.headline?.label) || 'not measured',
    kind: str(m?.headline?.kind),
  },
  weakestClass: m?.weakest_class
    ? {
        label: str(m.weakest_class.label),
        score: maybe(m.weakest_class.score),
        basis: str(m.weakest_class.basis),
        support: maybe(m.weakest_class.support),
      }
    : null,
  currentEvaluation: m?.current_evaluation ? evaluation(m.current_evaluation) : null,
  evaluations: list(m?.evaluations).map(evaluation),
  trainingRuns: list(m?.training_runs).map(trainingRun),
  runCounts: {
    total: num(m?.run_counts?.total),
    deployed: num(m?.run_counts?.deployed),
    rejected: num(m?.run_counts?.rejected),
    superseded: num(m?.run_counts?.superseded),
  },
  liveStats: liveStats(m?.live_stats),
  exercised: Boolean(m?.exercised),
})

export const getReview = ({ days = 30 } = {}) =>
  req('/review', { query: { days } }).then((d) => ({
    generatedAt: str(d?.generated_at),
    windowDays: num(d?.window_days, 30),
    totalPosts: num(d?.corpus?.total_posts),
    models: list(d?.models).map(reviewModel),
    summary: {
      totalVersions: num(d?.summary?.total_versions),
      live: num(d?.summary?.live),
      trainingRuns: num(d?.summary?.training_runs),
      rejectedRuns: num(d?.summary?.rejected_runs),
      evaluations: num(d?.summary?.evaluations),
    },
  }))

const service = (s) => ({
  key: str(s?.key),
  label: str(s?.label),
  role: str(s?.role),
  state: str(s?.state) || 'unknown',
  container: str(s?.detail?.container),
  address: str(s?.detail?.address),
  reason: str(s?.detail?.reason),
  note: str(s?.detail?.note),
  // Flatten to scalars: React throws on an object child, and `models` here is
  // a {laya, gliner} object on the sidecar entry.
  models: s?.detail?.models
    ? Object.entries(s.detail.models).map(([k, v]) => ({ name: k, loaded: Boolean(v) }))
    : [],
  lastActivity: str(s?.detail?.last_activity),
  ageSeconds: maybe(s?.detail?.age_seconds),
})

const stage = (s) => ({
  key: str(s?.key),
  label: str(s?.label),
  description: str(s?.description),
  state: str(s?.state) || 'unknown',
  lastStatus: str(s?.last_status),
  lastStartedAt: str(s?.last_started_at),
  lastFinishedAt: str(s?.last_finished_at),
  lastError: str(s?.last_error),
  ageSeconds: maybe(s?.age_seconds),
  runs24h: { done: num(s?.runs_24h?.done), failed: num(s?.runs_24h?.failed) },
  successRate24h: maybe(s?.success_rate_24h),
  successRateAll: maybe(s?.success_rate_all),
  queue: s?.queue && typeof s.queue === 'object' ? s.queue : {},
  // last_stats is free-form jsonb from the run — surfaced as label/value pairs
  // rather than rendered raw (React cannot render an object child).
  lastStats: Object.entries(s?.last_stats ?? {})
    .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => ({ key: k, value: v === null ? '—' : String(v) })),
})

export const getSystem = () =>
  req('/system').then((d) => ({
    generatedAt: str(d?.generated_at),
    overall: str(d?.overall) || 'unknown',
    services: list(d?.services).map(service),
    stages: list(d?.stages).map(stage),
    queue: {
      pending: num(d?.queue?.pending),
      running: num(d?.queue?.running),
      dead: num(d?.queue?.dead),
      workerState: str(d?.queue?.worker_state) || 'unknown',
      workerReason: str(d?.queue?.worker_reason),
      workerLastActivity: str(d?.queue?.worker_last_activity),
      byKind: Object.entries(d?.queue?.by_kind ?? {}).map(([kind, counts]) => ({
        kind,
        counts: Object.entries(counts ?? {}).map(([k, v]) => ({ status: k, count: num(v) })),
      })),
    },
    counts: {
      posts: num(d?.counts?.posts),
      topics: num(d?.counts?.topics),
      priorityResults: num(d?.counts?.priority_results),
      sentimentResults: num(d?.counts?.sentiment_results),
      extractions: num(d?.counts?.extractions),
      insights: num(d?.counts?.insights),
      posts24h: num(d?.counts?.posts_24h),
    },
  }))

/* ---- formatting helpers ------------------------------------------------------ */
export function relTime(ts) {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function formatDate(ts) {
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
export { req as getApi }

/* ---- Ops / production hardening (2026-09-28) --------------------------------- */

const opsBool = (v) => v === true || v === 'true'

export const getOpsConfig = () => req('/admin/ops/config')

export const saveOpsConfig = (patch) =>
  req('/admin/ops/config', { method: 'POST', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' } })

export const getOpsOverview = () =>
  req('/admin/ops/overview').then((d) => ({
    queue: {
      pending: num(d?.queue?.pending),
      running: num(d?.queue?.running),
      dead: num(d?.queue?.dead),
      workerState: str(d?.queue?.worker_state) || 'unknown',
      workerReason: str(d?.queue?.worker_reason),
      lastActivity: str(d?.queue?.last_activity),
      byKind: d?.queue?.by_kind ?? {},
    },
    deadJobs: list(d?.dead_jobs).map((j) => ({
      id: num(j?.id),
      kind: str(j?.kind),
      attempts: num(j?.attempts),
      error: str(j?.error),
      lastTry: str(j?.last_try),
    })),
    sidecar: {
      reachable: Boolean(d?.sidecar?.reachable),
      warm: Boolean(d?.sidecar?.warm),
      idleUnloadS: num(d?.sidecar?.idle_unload_s),
      idleUnloadEnabled: opsBool(d?.sidecar?.idle_unload_enabled),
      secondsSinceLastUse: num(d?.sidecar?.seconds_since_last_use),
      requestsTotal: num(d?.sidecar?.requests_total),
      requestsFailed: num(d?.sidecar?.requests_failed),
      rejectedSaturation: num(d?.sidecar?.rejected_saturation),
      textsClassified: num(d?.sidecar?.texts_classified),
      textsExtracted: num(d?.sidecar?.texts_extracted),
      vramMb: d?.sidecar?.gpu_vram_allocated_mb ?? null, // null = not measured
      uptimeS: num(d?.sidecar?.uptime_s),
    },
    storage: {
      state: str(d?.storage?.state) || 'unknown',
      usedPct: num(d?.storage?.used_pct),
      freeGb: num(d?.storage?.free_gb),
      totalGb: num(d?.storage?.total_gb),
    },
    retentionPolicy: {
      jobDoneDays: num(d?.retention_policy?.job_done_retention_days),
      runDays: num(d?.retention_policy?.run_retention_days),
      auditDays: num(d?.retention_policy?.audit_retention_days),
    },
    prom24h: {
      // Prometheus increase() over counters yields fractions (reset
      // interpolation) — job counts display as whole numbers.
      jobsDone: Number.isFinite(d?.prometheus_24h?.jobs_done_24h) ? Math.round(d.prometheus_24h.jobs_done_24h) : null,
      jobsFailed: Number.isFinite(d?.prometheus_24h?.jobs_failed_24h) ? Math.round(d.prometheus_24h.jobs_failed_24h) : null,
      jobRetries: Number.isFinite(d?.prometheus_24h?.job_retries_24h) ? Math.round(d.prometheus_24h.job_retries_24h) : null,
    },
  }))

export const triggerMaintenance = () => req('/admin/ops/maintenance/run', { method: 'POST' })

const normalizeInsightRun = (r) => ({
  id: num(r.id),
  status: str(r.status),
  model: str(r.model),
  postsCovered: num(r.posts_covered),
  topicsCovered: num(r.topics_covered),
  chunkCalls: num(r.chunk_calls),
  tokens: num(r.total_tokens),
  costUsd: maybe(r.cost_usd),
  durationMs: num(r.duration_ms),
  generated: num(r.insights_generated),
  accepted: num(r.insights_accepted),
  rejected: num(r.insights_rejected),
  error: str(r.error),
  createdAt: str(r.created_at),
  triggeredBy: str(r.triggered_by),
})

export const getInsightRuns = (page = 1, per = 15) =>
  req(`/admin/insight-runs?limit=${per}&offset=${(page - 1) * per}`).then((d) => ({
    items: list(d.items).map(normalizeInsightRun),
    total: num(d.total),
    page,
  }))

export const getInsightRun = (id) =>
  req(`/admin/insight-runs/${id}`).then((d) => ({
    ...normalizeInsightRun(d.run),
    insights: list(d.insights).map((ins) => ({
      id: num(ins.id),
      type: str(ins.insight_type),
      severity: str(ins.severity),
      title: str(ins.title),
      status: str(ins.status),
      createdAt: str(ins.created_at),
    })),
  }))

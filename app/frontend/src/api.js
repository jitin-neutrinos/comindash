import { useEffect, useState } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
export { BASE as API_BASE }

async function req(path, { query, ...options } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : ''
  const res = await fetch(`${BASE}${path}${qs}`, {
    headers: { Accept: 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request to ${path} failed (${res.status})`)
  }
  return res.json()
}

/* ---- normalizers: the only place backend field names are known ------------- */
const num = (v, d = 0) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d)
const list = (v) => (Array.isArray(v) ? v : [])

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
  avgSentiment: num(d.avg_sentiment ?? d.avgSentiment),
  highPriorityCount: num(d.high_priority_count ?? d.highPriorityCount),
  activePainPoints: num(d.active_pain_points ?? d.activePainPoints),
  modelConfidence: num(d.model_confidence ?? d.modelConfidence),
  pipelineHealth,
  generatedAt: d.generated_at ?? d.last_updated ?? null,
  }
}

const insightCard = (i) => ({
  id: i.id,
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
  title: t.title ?? '',
  category: t.category ?? '',
  postsCount: num(t.posts_count ?? t.postsCount),
  views: num(t.views),
  likeCount: num(t.like_count ?? t.likeCount),
  lastPostedAt: t.last_posted_at ?? t.lastPostedAt ?? null,
})

// routes/posts.py nests the badges: {..., analysis: {priority, priority_confidence,
// sentiment, sentiment_intensity, sentiment_confidence, model_version}}
const post = (p) => {
  const a = p.analysis ?? {}
  return {
    id: p.id,
    topicTitle: p.topic_title ?? p.topic?.title ?? '',
    postNumber: num(p.post_number ?? p.postNumber),
    author: p.author_hash ?? p.authorHash ?? 'anonymous',
    excerpt: p.body_text ?? p.body ?? '',
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
export const getPainPoints = () =>
  req('/pain-points').then((d) => list(d.items ?? d.pain_points ?? d.insights ?? d).map(insightCard))
export const getInsight = (id) => req(`/insights/${id}`).then(insightDetail)
export const getRelationships = () =>
  req('/relationships').then((d) => {
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

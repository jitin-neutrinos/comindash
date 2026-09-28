// Per-metric infographics: the things a plain line chart cannot say.
//
// Each panel is built from measurements that already exist in the intel
// payload, so nothing here recomputes statistics in the browser — the UI's job
// is to make a measured fact legible, not to invent one.
//
// Animation is GSAP (the project's existing dependency) and honours reduced
// motion; a bar that cannot animate still renders at its correct width.
import { useLayoutEffect, useRef } from 'react'
import { colors, alpha } from '../../theme'
import { gsap, canAnimateEntrance } from '../../motion'
import { SERIES_KEYS, WATCH_KEY, pct, signedPct, shortDate } from './vocab'

/** Grow an element to `width%` on mount/update. */
function useGrow(width, delay = 0) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const target = `${Math.max(0, Math.min(width, 100))}%`
    if (!canAnimateEntrance()) {
      gsap.set(el, { width: target })
      return
    }
    gsap.fromTo(
      el,
      { width: 0 },
      { width: target, duration: 0.55, delay, ease: 'power3.out' },
    )
  }, [width, delay])
  return ref
}

/** Stagger children in on mount — used for lists of measured rows. */
function useStagger(dep) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const items = el.querySelectorAll('[data-stagger]')
    if (!items.length) return
    if (!canAnimateEntrance()) {
      gsap.set(items, { opacity: 1, x: 0 })
      return
    }
    gsap.fromTo(
      items,
      { opacity: 0, x: -6 },
      { opacity: 1, x: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' },
    )
  }, [dep])
  return ref
}

const Panel = ({ title, hint, children, className = '' }) => (
  // min-w-0 lets long thread titles inside truncate instead of forcing the
  // whole grid column wider than the viewport.
  <section className={`min-w-0 rounded-2xl border border-line bg-white p-5 ${className}`}>
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="min-w-0 text-h5 font-semibold">{title}</h3>
      {hint ? <span className="shrink-0 text-caption text-muted">{hint}</span> : null}
    </div>
    <div className="mt-4 min-w-0">{children}</div>
  </section>
)

/** Horizontal bar — one measured quantity against the largest in its set. */
function Bar({ label, value, max, color, caption, delay = 0 }) {
  const w = max > 0 ? Math.max((value / max) * 100, 1.5) : 0
  const fill = useGrow(w, delay)
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-small" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-caption tabular-nums text-muted">
          {caption ?? Math.round(value).toLocaleString()}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-pill"
        style={{ backgroundColor: alpha(colors.midnight, 0.06) }}
      >
        <div ref={fill} className="h-full rounded-pill" style={{ backgroundColor: color }} />
      </div>
    </div>
  )
}

/** Mix drift: how a composition moved between the two halves of the window. */
export function DriftPanel({ intel }) {
  const keys = SERIES_KEYS[intel.metric]
  const watch = WATCH_KEY[intel.metric]
  const drift = intel.drift ?? {}
  if (!keys) return null

  return (
    <Panel title="How the mix shifted" hint="first half → second half">
      <div className="space-y-4">
        {keys.map((k) => {
          const d = drift[k.key] ?? { before: 0, after: 0, delta: 0 }
          const rising = d.delta > 0.005
          const falling = d.delta < -0.005
          // "Bad" is metric-specific: negative sentiment rising is bad, positive
          // rising is good. Colour the delta by meaning, not by sign.
          const concerning = k.bad ? rising : falling
          return (
            <DriftRow
              key={k.key}
              k={k}
              d={d}
              tone={
                concerning
                  ? colors.salmon
                  : rising || falling
                    ? colors.mint
                    : alpha(colors.midnight, 0.45)
              }
            />
          )
        })}
      </div>

      {drift[watch]?.delta > 0.02 ? (
        <p
          className="mt-4 rounded-lg p-2.5 text-caption leading-relaxed"
          style={{ backgroundColor: alpha(colors.salmon, 0.08) }}
        >
          The {intel.metric === 'sentiment' ? 'negative' : 'high-priority'} share grew{' '}
          {signedPct(drift[watch].delta, 1)} across this window — the mix is moving even if
          totals look flat.
        </p>
      ) : null}
    </Panel>
  )
}

function DriftRow({ k, d, tone }) {
  const after = useGrow(d.after * 100)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-small">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: k.color }}
            aria-hidden="true"
          />
          {k.label}
        </span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span className="text-caption text-muted">
            {pct(d.before)} → {pct(d.after)}
          </span>
          <span className="text-small font-medium" style={{ color: tone }}>
            {signedPct(d.delta, 1)}
          </span>
        </span>
      </div>
      {/* Two stacked tracks: before (faint) and after (solid) so the movement
          is visible without reading the numbers. */}
      <div className="space-y-0.5">
        <div
          className="h-1 overflow-hidden rounded-pill"
          style={{ backgroundColor: alpha(colors.midnight, 0.05) }}
        >
          <div
            className="h-full rounded-pill"
            style={{ width: `${d.before * 100}%`, backgroundColor: alpha(k.color, 0.35) }}
          />
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-pill"
          style={{ backgroundColor: alpha(colors.midnight, 0.05) }}
        >
          <div ref={after} className="h-full rounded-pill" style={{ backgroundColor: k.color }} />
        </div>
      </div>
    </div>
  )
}

/** Days the data itself flags as unusual, with plain-English framing. */
export function AnomalyPanel({ intel }) {
  const anomalies = intel.anomalies ?? []
  const isShare = intel.metric === 'sentiment' || intel.metric === 'priority'
  const listRef = useStagger(anomalies.length)

  return (
    <Panel title="Unusual days" hint="robust outlier detection">
      {anomalies.length ? (
        <ul ref={listRef} className="space-y-3">
          {anomalies.map((a) => (
            <li key={a.date} data-stagger className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-caption font-semibold"
                style={{
                  backgroundColor: alpha(
                    a.direction === 'spike' ? colors.salmon : colors.blue,
                    0.12,
                  ),
                  color: a.direction === 'spike' ? colors.salmon : colors.blue,
                }}
                aria-hidden="true"
              >
                {a.direction === 'spike' ? '↑' : '↓'}
              </span>
              <div className="min-w-0">
                <p className="text-small font-medium">{shortDate(a.date)}</p>
                <p className="text-caption text-muted">
                  {isShare
                    ? pct(a.value, 1)
                    : `${Math.round(a.value)}${intel.metric === 'volume' ? ' posts' : ''}`}
                  {' — '}
                  {a.direction === 'spike' ? 'well above' : 'well below'} the typical day (score{' '}
                  {Math.abs(a.score).toFixed(1)})
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted">
          No day in this window departs far enough from the norm to flag. Activity is behaving
          consistently.
        </p>
      )}

      {intel.changePoint ? (
        <div className="mt-4 rounded-lg border border-hairline p-3">
          <p className="text-caption font-medium uppercase tracking-wide text-muted">Level shift</p>
          <p className="mt-1 text-small">
            The series best splits at <strong>{shortDate(intel.changePoint.date)}</strong> —
            behaviour before and after that day differs enough to look like a change, not noise.
          </p>
        </div>
      ) : null}
    </Panel>
  )
}

/** Volume: rhythm + concentration — where the posts actually came from. */
export function VolumeShapePanel({ intel }) {
  const weekday = intel.weekday ?? []
  const maxWeekday = Math.max(...weekday.map((w) => w.avg), 0)
  const topics = intel.topTopics ?? []
  const maxTopic = Math.max(...topics.map((t) => t.count), 0)
  const barsRef = useRef(null)

  useLayoutEffect(() => {
    const el = barsRef.current
    if (!el) return
    const bars = el.querySelectorAll('[data-weekday]')
    if (!bars.length) return
    if (!canAnimateEntrance()) {
      bars.forEach((b) => gsap.set(b, { height: b.dataset.h }))
      return
    }
    bars.forEach((b, i) =>
      gsap.fromTo(
        b,
        { height: 0 },
        { height: b.dataset.h, duration: 0.45, delay: i * 0.03, ease: 'power3.out' },
      ),
    )
  }, [weekday])

  return (
    <Panel title="Where the volume came from" hint={`${intel.activeAuthors} authors`}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-caption font-medium uppercase tracking-wide text-muted">
            Posting rhythm
          </p>
          <div ref={barsRef} className="flex items-end gap-1.5" style={{ height: 64 }}>
            {weekday.map((w) => (
              <div key={w.day} className="flex flex-1 flex-col items-center gap-1">
                <div
                  data-weekday
                  data-h={`${maxWeekday ? (w.avg / maxWeekday) * 48 : 0}px`}
                  className="w-full rounded-t-sm"
                  style={{ backgroundColor: alpha(colors.blue, 0.75) }}
                  title={`${w.day}: ${w.avg} posts/day average`}
                />
                <span className="text-caption text-muted">{w.day[0]}</span>
              </div>
            ))}
          </div>
        </div>

        {topics.length ? (
          <div>
            <p className="mb-2 text-caption font-medium uppercase tracking-wide text-muted">
              Busiest threads
            </p>
            <div className="space-y-2.5">
              {topics.map((t, i) => (
                <Bar
                  key={t.label}
                  label={t.label}
                  value={t.count}
                  max={maxTopic}
                  color={colors.blue}
                  delay={i * 0.04}
                />
              ))}
            </div>
            {intel.topTopicShare > 0.2 ? (
              <p className="mt-3 text-caption text-muted">
                One thread carries {pct(intel.topTopicShare)} of all posts in this window —
                activity is concentrated, not broad.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

/** Entities: what is gaining and losing attention. */
export function MoversPanel({ intel }) {
  const risers = intel.risers ?? []
  const fallers = intel.fallers ?? []
  const maxAfter = Math.max(...risers.map((r) => r.after), 1)
  const maxBefore = Math.max(...fallers.map((f) => f.before), 1)

  const caption = (m, rising) =>
    m.status === 'new'
      ? `new · ${Math.round(m.after)}`
      : m.status === 'gone'
        ? `gone · was ${Math.round(m.before)}`
        : `${signedPct(m.change)} · ${Math.round(rising ? m.after : m.before)}`

  return (
    <Panel title="Attention movers" hint="first half → second half">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p
            className="mb-2.5 text-caption font-medium uppercase tracking-wide"
            style={{ color: colors.mint }}
          >
            Gaining
          </p>
          {risers.length ? (
            <div className="space-y-2.5">
              {risers.map((m, i) => (
                <Bar
                  key={m.key}
                  label={m.label}
                  value={m.after}
                  max={maxAfter}
                  color={colors.mint}
                  caption={caption(m, true)}
                  delay={i * 0.04}
                />
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted">Nothing rose meaningfully.</p>
          )}
        </div>
        <div>
          <p
            className="mb-2.5 text-caption font-medium uppercase tracking-wide"
            style={{ color: colors.salmon }}
          >
            Fading
          </p>
          {fallers.length ? (
            <div className="space-y-2.5">
              {fallers.map((m, i) => (
                <Bar
                  key={m.key}
                  label={m.label}
                  value={m.before}
                  max={maxBefore}
                  color={colors.salmon}
                  caption={caption(m, false)}
                  delay={i * 0.04}
                />
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted">Nothing fell meaningfully.</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-caption text-muted">
        Entities mentioned fewer than 4 times in both halves are excluded — their percentage
        swings are noise.
      </p>
    </Panel>
  )
}

/** Entity composition: who owns the conversation. */
export function CategoryPanel({ intel }) {
  const cats = intel.byCategory ?? []
  const max = Math.max(...cats.map((c) => c.count), 1)
  return (
    <Panel
      title="Who owns the conversation"
      hint={`${intel.distinctEntities.toLocaleString()} distinct`}
    >
      <div className="space-y-2.5">
        {cats.map((c, i) => (
          <Bar
            key={c.label}
            label={c.label}
            value={c.count}
            max={max}
            color={colors.mint}
            caption={pct(c.share)}
            delay={i * 0.03}
          />
        ))}
      </div>
      <p className="mt-4 text-caption text-muted">
        {pct(intel.productShare)} of mentions name a Neutrinos product; the rest are people and
        general terms.
      </p>
    </Panel>
  )
}

/** Priority: which threads carry the urgent load. */
export function HotTopicsPanel({ intel }) {
  const topics = intel.hotTopics ?? []
  if (!topics.length) return null
  const max = Math.max(...topics.map((t) => t.count), 1)
  return (
    <Panel title="Where the urgent load sits" hint="high-priority posts by thread">
      <div className="space-y-2.5">
        {topics.map((t, i) => (
          <Bar
            key={t.label}
            label={t.label}
            value={t.count}
            max={max}
            color={colors.salmon}
            delay={i * 0.04}
          />
        ))}
      </div>
    </Panel>
  )
}

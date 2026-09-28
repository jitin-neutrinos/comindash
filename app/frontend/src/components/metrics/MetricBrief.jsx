// The consultant's read on the current metric slice.
//
// Sits beside the chart and answers the question the chart cannot: is this
// normal, what changed, and what should we do. Same grounding discipline as
// the Insights brief — a measurement-only fallback is labelled as such and
// never wears the styling of AI analysis.
//
// Animation uses the project's own stack (GSAP + CSS), and respects reduced
// motion: no new dependency for a fade.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getMetricBrief } from '../../api'
import { blueFill, colors, alpha } from '../../theme'
import { gsap, canAnimateEntrance } from '../../motion'
import { confidenceColor, metricMeta } from './vocab'

export default function MetricBrief({ metric, days, intel }) {
  const [brief, setBrief] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const reqId = useRef(0)
  const bodyRef = useRef(null)
  const meta = metricMeta(metric)

  // A brief describes one (metric, window) slice. When either changes the old
  // text is about different data — drop it rather than leave stale analysis
  // sitting under a new chart.
  useEffect(() => {
    setBrief(null)
    setError(null)
  }, [metric, days])

  // Entrance for the result, once it exists.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || !brief) return
    // Reduced motion, or a hidden tab where rAF is frozen: show the brief
    // outright rather than leaving it at the tween's opacity-0 start.
    if (!canAnimateEntrance()) {
      gsap.set(el, { opacity: 1, y: 0 })
      return
    }
    gsap.fromTo(
      el,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' },
    )
  }, [brief])

  const run = async (refresh = false) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const b = await getMetricBrief({ metric, days, refresh })
      // A slower earlier request must not overwrite a newer one.
      if (id === reqId.current) setBrief(b)
    } catch (e) {
      if (id === reqId.current) setError(e?.message || 'Could not generate a brief.')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  const hasData =
    metric === 'volume'
      ? (intel?.total ?? 0) > 0
      : metric === 'entity'
        ? (intel?.totalMentions ?? 0) > 0
        : (intel?.labelledPosts ?? 0) > 0

  return (
    <section
      className="rounded-2xl border border-line bg-surface p-5"
      aria-label={`${meta.label} briefing`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h5 font-semibold">Analyst read</h3>
          <p className="mt-0.5 text-caption text-muted">{meta.question}</p>
        </div>
        {brief ? (
          <button
            type="button"
            onClick={() => run(true)}
            disabled={loading}
            className="shrink-0 rounded-md px-2 py-1 text-caption text-muted transition-colors hover:bg-hairline hover:text-black disabled:opacity-40"
          >
            {loading ? 'Thinking…' : 'Regenerate'}
          </button>
        ) : null}
      </div>

      {!brief && !loading ? (
        <div className="mt-4">
          {hasData ? (
            <>
              <p className="text-small text-muted">
                Interpret this window&rsquo;s measurements — what changed, whether it is
                normal, and what to do next.
              </p>
              <button
                type="button"
                onClick={() => run(false)}
                className="mt-3 rounded-lg px-3 py-2 text-small font-medium text-white transition-transform active:scale-[0.98]"
                style={{ backgroundColor: blueFill }}
              >
                Brief me on {meta.label.toLowerCase()}
              </button>
            </>
          ) : (
            <p className="text-small text-muted">
              No measured data in this window, so there is nothing to interpret.
            </p>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="mt-4 space-y-2" aria-live="polite">
          <div className="shimmer h-3 w-4/5 rounded-sm" />
          <div className="shimmer h-3 w-full rounded-sm" />
          <div className="shimmer h-3 w-2/3 rounded-sm" />
          <p className="pt-1 text-caption text-muted">Reading the measurements…</p>
        </div>
      ) : null}

      {brief && !loading ? (
        <div ref={bodyRef} className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-pill px-2 py-0.5 text-caption font-medium"
              style={{
                backgroundColor: alpha(confidenceColor()[brief.confidence], 0.14),
                color: confidenceColor()[brief.confidence],
              }}
            >
              {brief.confidence} confidence
            </span>
            {/* Honesty marker: the fallback is never dressed as analysis. */}
            {brief.mode === 'evidence' ? (
              <span
                className="rounded-pill px-2 py-0.5 text-caption"
                style={{
                  backgroundColor: alpha(colors.black, 0.07),
                  color: alpha(colors.black, 0.65),
                }}
                title={brief.reason || 'Generated from measurements only'}
              >
                measured summary — no AI analysis
              </span>
            ) : null}
            {brief.cached ? <span className="text-caption text-muted">cached</span> : null}
          </div>

          {brief.headline ? (
            <p className="text-body font-medium leading-snug">{brief.headline}</p>
          ) : null}

          {brief.assessment ? (
            <p className="text-small leading-relaxed text-muted">{brief.assessment}</p>
          ) : null}

          {brief.findings.length ? (
            <ul className="space-y-2">
              {brief.findings.map((f, i) => (
                <li key={i} className="flex gap-2.5">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: blueFill }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 text-small">
                    {f.label ? <span className="font-medium">{f.label}. </span> : null}
                    <span className="text-muted">{f.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {brief.actions.length ? (
            <div className="rounded-xl border border-hairline p-3">
              <p className="text-caption font-medium uppercase tracking-wide text-muted">
                Suggested next steps
              </p>
              <ol className="mt-2 space-y-1.5">
                {brief.actions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-small">
                    <span className="tabular-nums text-muted">{i + 1}.</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {brief.watchOut ? (
            <p
              className="rounded-lg p-2.5 text-caption leading-relaxed"
              style={{
                backgroundColor: alpha(colors.salmon, 0.08),
                color: alpha(colors.black, 0.8),
              }}
            >
              <span className="font-medium">Watch out: </span>
              {brief.watchOut}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-caption" style={{ color: colors.salmon }}>
          {error}
        </p>
      ) : null}
    </section>
  )
}

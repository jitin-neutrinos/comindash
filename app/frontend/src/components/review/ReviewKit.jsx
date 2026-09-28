// Review-page primitives: score dials, metric bars, confusion matrices and
// git provenance rails.
//
// Design intent (brand-core first):
//   * White + Neutrinos Blue dominate; depth from the shared Bezel, not boxes.
//   * A missing metric renders as "not measured", never as 0. A zero score and
//     an unmeasured score look identical on a bar chart, and that is the single
//     most dangerous thing a model-review page can get wrong.
//   * Every number states its basis (holdout rows, window, git SHA) so a reader
//     can tell a 93% measured on 363 rows from a 93% measured on 12.
import { useEffect, useRef, useState } from 'react'
import { alpha, blueFill, colors, semantics } from '../../theme'
import { transition } from '../Surface'
import { formatDate, relTime } from '../../api'
import { prefersReducedMotion } from '../../motion'

/* ---- shared scales --------------------------------------------------------- */

/** Score → brand-ramp colour. Thresholds are deliberately conservative:
 *  below 0.70 on a 3-class task is barely above chance and must not read green. */
export function scoreColor(v) {
  if (v === null || v === undefined) return alpha(colors.black, 0.25)
  if (v >= 0.9) return colors.blue
  if (v >= 0.75) return colors.celeste
  if (v >= 0.6) return colors.iris
  return colors.salmon
}

export const pct = (v, digits = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`

export const STAGE_TONE = {
  live: colors.blue,
  candidate: colors.celeste,
  rejected: colors.salmon,
  superseded: alpha(colors.black, 0.4),
  registered: colors.iris,
}

export const STATE_TONE = {
  ok: colors.blue,
  idle: colors.celeste,
  warn: colors.iris,
  down: colors.salmon,
  unknown: alpha(colors.black, 0.35),
}

/* ---- score dial ------------------------------------------------------------ */

/**
 * Headline score as a ring. The ring animates from 0 on mount, but an
 * unmeasured score draws no ring at all — an empty ring is honest, a full grey
 * ring would imply a measurement that does not exist.
 */
export function ScoreDial({ value, label, caption, size = 132, stroke = 9 }) {
  const ref = useRef(null)
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const measured = value !== null && value !== undefined
  const color = scoreColor(value)

  useEffect(() => {
    const el = ref.current
    if (!el || !measured) return undefined
    const target = circumference * (1 - value)
    if (prefersReducedMotion()) {
      el.style.strokeDashoffset = String(target)
      return undefined
    }
    el.style.strokeDashoffset = String(circumference)
    const id = requestAnimationFrame(() => {
      el.style.transition = transition('stroke-dashoffset', 900)
      el.style.strokeDashoffset = String(target)
    })
    return () => cancelAnimationFrame(id)
  }, [value, circumference, measured])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={alpha(colors.black, 0.07)}
            strokeWidth={stroke}
          />
          {measured && (
            <circle
              ref={ref}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-h2 font-semibold leading-none tabular-nums tracking-tight"
            style={{ color: measured ? colors.black : alpha(colors.black, 0.4) }}
          >
            {measured ? pct(value, 1) : '—'}
          </span>
          {caption && (
            <span className="mt-1 text-[10px] font-light uppercase tracking-wider text-muted">
              {caption}
            </span>
          )}
        </div>
      </div>
      <p className="max-w-[16rem] text-center text-caption font-light leading-snug text-muted">
        {label}
      </p>
    </div>
  )
}

/** Machine label → readable label. CSS `capitalize` turns `ai_hub` into
 *  "Ai_hub"; these are vocabulary terms with real names, so they get spelled
 *  properly rather than title-cased by the stylesheet. */
const LABEL_TEXT = {
  ai_hub: 'AI Hub',
  ssd: 'SSD',
  pos: 'Positive',
  neu: 'Neutral',
  neg: 'Negative',
  co_occurrence: 'Co-occurrence',
}
export const labelText = (l) =>
  LABEL_TEXT[l] ?? String(l).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/* ---- metric bar ------------------------------------------------------------ */

/** One labelled 0–1 bar. `support` is shown because a class scored on 9 rows
 *  and one scored on 300 are not comparable evidence. */
export function MetricBar({ label, value, support, basis, delay = 0 }) {
  const ref = useRef(null)
  const measured = value !== null && value !== undefined
  const color = scoreColor(value)

  useEffect(() => {
    const el = ref.current
    if (!el || !measured) return undefined
    if (prefersReducedMotion()) {
      el.style.width = `${value * 100}%`
      return undefined
    }
    el.style.width = '0%'
    const id = setTimeout(() => {
      el.style.transition = transition('width', 760)
      el.style.width = `${value * 100}%`
    }, delay)
    return () => clearTimeout(id)
  }, [value, measured, delay])

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-small font-medium">{labelText(label)}</span>
        <span
          className="shrink-0 text-small font-semibold tabular-nums"
          style={{ color: measured ? color : alpha(colors.black, 0.4) }}
        >
          {measured ? pct(value, 1) : 'not measured'}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill"
        style={{ backgroundColor: alpha(colors.black, 0.06) }}
      >
        <div
          ref={ref}
          className="h-full rounded-pill"
          style={{ width: 0, backgroundColor: color }}
        />
      </div>
      {(support !== null && support !== undefined) || basis ? (
        <p className="mt-1 text-caption font-light text-muted">
          {support !== null && support !== undefined ? `${support.toLocaleString()} rows` : ''}
          {support !== null && support !== undefined && basis ? ' · ' : ''}
          {basis}
        </p>
      ) : null}
    </div>
  )
}

/* ---- distribution bar ------------------------------------------------------ */

/** Live label distribution as a single stacked rail — shape at a glance. */
export function DistributionRail({ rows, tone }) {
  const total = rows.reduce((a, r) => a + r.count, 0)
  if (!total) return <p className="text-small font-light text-muted">No rows yet.</p>
  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-pill"
        style={{ backgroundColor: alpha(colors.black, 0.06) }}
      >
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              width: `${(r.count / total) * 100}%`,
              backgroundColor:
                tone?.[r.label] ??
                [colors.blue, colors.celeste, colors.iris, colors.mint, colors.salmon][i % 5],
              transition: transition('width', 700),
            }}
            title={`${labelText(r.label)}: ${r.count.toLocaleString()} (${((r.count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-center gap-1.5 text-caption">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  tone?.[r.label] ??
                  [colors.blue, colors.celeste, colors.iris, colors.mint, colors.salmon][i % 5],
              }}
            />
            <span className="font-medium">{labelText(r.label)}</span>
            <span className="font-light tabular-nums text-muted">
              {r.count.toLocaleString()} · {((r.count / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---- confusion matrix ------------------------------------------------------ */

/**
 * Gold (rows) × predicted (columns). Cell tint scales within each gold row, so
 * a rare class's error pattern is still visible next to a dominant one — a
 * global scale would wash small classes out entirely.
 */
export function ConfusionMatrix({ confusion }) {
  const golds = Object.keys(confusion ?? {})
  if (!golds.length) return null
  const preds = Array.from(
    new Set(golds.flatMap((g) => Object.keys(confusion[g] ?? {}))),
  ).sort()

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] border-separate border-spacing-1 text-caption">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-muted">gold ↓ / pred →</th>
            {preds.map((p) => (
              <th key={p} className="px-2 py-1 text-center font-medium">
                {labelText(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {golds.map((g) => {
            const row = confusion[g] ?? {}
            const rowTotal = Object.values(row).reduce((a, b) => a + Number(b || 0), 0) || 1
            return (
              <tr key={g}>
                <th className="px-2 py-1 text-left font-medium">{labelText(g)}</th>
                {preds.map((p) => {
                  const n = Number(row[p] ?? 0)
                  const share = n / rowTotal
                  const correct = g === p
                  return (
                    <td
                      key={p}
                      className="rounded-sm px-2 py-1.5 text-center tabular-nums"
                      style={{
                        backgroundColor: alpha(
                          correct ? colors.blue : colors.salmon,
                          Math.max(share * 0.55, n ? 0.06 : 0.02),
                        ),
                        fontWeight: correct ? 600 : 400,
                      }}
                      title={`gold ${g} → predicted ${p}: ${n} (${(share * 100).toFixed(1)}% of gold ${g})`}
                    >
                      {n}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-2 text-caption font-light text-muted">
        Blue on the diagonal is correct; salmon off it is the error pattern. Tint scales
        within each gold row, so rare classes stay readable.
      </p>
    </div>
  )
}

/* ---- git provenance rail --------------------------------------------------- */

/** Commit history for the files that define a model — the version trail. */
export function GitRail({ commits, paths, head }) {
  const [open, setOpen] = useState(false)
  if (!commits?.length) {
    return (
      <p className="text-small font-light text-muted">
        No commits recorded for this model&apos;s source paths.
      </p>
    )
  }
  const shown = open ? commits : commits.slice(0, 4)
  return (
    <div>
      <ol className="relative space-y-3 pl-5">
        <span
          aria-hidden="true"
          className="absolute left-[3px] top-2 bottom-2 w-px"
          style={{ backgroundColor: alpha(colors.black, 0.12) }}
        />
        {shown.map((c, i) => {
          const isHead = c.sha === head
          return (
            <li key={c.sha} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-5 top-1.5 h-[7px] w-[7px] rounded-full"
                style={{
                  backgroundColor: i === 0 ? blueFill : alpha(colors.black, 0.3),
                  boxShadow: i === 0 ? `0 0 0 3px ${alpha(colors.blue, 0.15)}` : undefined,
                }}
              />
              <div className="flex flex-wrap items-baseline gap-x-2">
                <code
                  className="rounded-sm px-1.5 py-0.5 text-caption font-semibold tabular-nums"
                  style={{ backgroundColor: alpha(colors.blue, 0.1), color: colors.blue }}
                >
                  {c.short}
                </code>
                {isHead && (
                  <span
                    className="rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ backgroundColor: alpha(colors.celeste, 0.2), color: colors.black }}
                  >
                    trained at
                  </span>
                )}
                <span className="text-caption font-light text-muted">
                  {formatDate(c.committedAt)} · {c.author}
                </span>
              </div>
              <p className="mt-0.5 text-small font-light leading-snug">{c.subject}</p>
            </li>
          )
        })}
      </ol>
      {commits.length > 4 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-caption font-medium"
          style={{ color: colors.blue }}
        >
          {open ? 'Show fewer' : `Show all ${commits.length} commits`}
        </button>
      )}
      {paths?.length > 0 && (
        <p className="mt-3 text-caption font-light leading-relaxed text-muted">
          Tracked paths:{' '}
          {paths.map((p, i) => (
            <span key={p}>
              {i > 0 && ', '}
              <code className="rounded-sm bg-mist px-1 py-0.5">{p}</code>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

/* ---- key/value spec grid --------------------------------------------------- */

export function SpecGrid({ items, columns = 2 }) {
  const rows = items.filter((i) => i && i.value !== '' && i.value !== null && i.value !== undefined)
  if (!rows.length) return null
  return (
    <dl
      className="grid gap-x-6 gap-y-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {rows.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-caption font-medium uppercase tracking-wider text-muted">
            {it.label}
          </dt>
          <dd className="mt-0.5 break-words text-small font-light leading-snug">
            {it.mono ? (
              <code className="rounded-sm bg-mist px-1.5 py-0.5 text-caption">{it.value}</code>
            ) : (
              it.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/* ---- status dot ------------------------------------------------------------ */

export function StatusDot({ state, pulse = false, size = 8 }) {
  const color = STATE_TONE[state] ?? STATE_TONE.unknown
  return (
    <span
      aria-hidden="true"
      data-pulse={pulse && (state === 'warn' || state === 'down') ? 'true' : undefined}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: `0 0 0 3px ${alpha(color, 0.16)}`,
      }}
      title={state}
    />
  )
}

/** Small labelled stat used across both the review and command-centre views. */
export function Stat({ label, value, tone, hint }) {
  return (
    <div className="min-w-0">
      <p className="text-caption font-medium uppercase tracking-wider text-muted">{label}</p>
      <p
        className="mt-1 text-h4 font-semibold leading-none tabular-nums tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-caption font-light text-muted">{hint}</p>}
    </div>
  )
}

/** "Last seen" phrasing that never lies when the timestamp is missing. */
export const seenLabel = (ts) => (ts ? relTime(ts) : 'never')

/* ---- self-check (module-level, dev only) ----------------------------------- */
if (import.meta.env?.DEV) {
  // An unmeasured score must not share a colour with a real zero, and must not
  // render as "0.0%" — the two mean opposite things to a reviewer.
  console.assert(scoreColor(null) !== scoreColor(0), 'unmeasured must differ from zero')
  console.assert(pct(null) === '—', 'unmeasured renders as em dash')
  console.assert(pct(0) === '0.0%', 'a real zero still renders as a number')
  console.assert(pct(0.934) === '93.4%', 'percentage formatting')
  console.assert(scoreColor(0.95) === colors.blue, 'strong score is brand blue')
  console.assert(scoreColor(0.4) === colors.salmon, 'weak score is flagged')
}

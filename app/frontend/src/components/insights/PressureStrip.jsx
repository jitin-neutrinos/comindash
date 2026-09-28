// The page's answer to "what is the state of things?", above any list.
//
// Four numbers, chosen because each one changes what you'd do next:
//   · what is moving        — where attention goes today
//   · recent pressure       — whether the forum itself is under strain
//   · coverage              — whether the insights explain what people post
//   · lineage               — whether conclusions are recurring or one-offs
//
// Coverage is the honest one: a low number means most recent discussion is
// NOT explained by any active insight, and the page says that plainly rather
// than hiding it.
import { useRef } from 'react'
import { colors, alpha } from '../../theme'
import { useCountUp } from '../../motion'
import { MOMENTUM_ORDER, momentumOf, pct } from './vocab'

function Figure({ value, label, sub, tone, format }) {
  const ref = useRef(null)
  useCountUp(ref, value, format)
  return (
    <div className="min-w-0">
      <p
        className="text-h2 font-semibold tabular-nums leading-none tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        <span ref={ref}>{format ? format(value) : value}</span>
      </p>
      <p className="mt-1.5 text-small font-medium">{label}</p>
      {sub && <p className="text-caption font-light text-muted">{sub}</p>}
    </div>
  )
}

/** Proportional bar of momentum states — the page's headline distribution. */
function StateBar({ byState, total, activeFilter, onFilter }) {
  const present = MOMENTUM_ORDER.filter((s) => (byState[s] ?? 0) > 0)
  if (!total) return null
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill" role="img" aria-label="Insights by momentum state">
        {present.map((s) => {
          const n = byState[s] ?? 0
          const m = momentumOf(s)
          return (
            <div
              key={s}
              style={{ width: `${(n / total) * 100}%`, backgroundColor: m.color }}
              title={`${n} ${m.label.toLowerCase()}`}
            />
          )
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
        {present.map((s) => {
          const n = byState[s] ?? 0
          const m = momentumOf(s)
          const on = activeFilter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => onFilter(on ? null : s)}
              aria-pressed={on}
              className="flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-caption transition-colors"
              style={{
                backgroundColor: on ? alpha(m.color, 0.14) : 'transparent',
                color: on ? m.color : undefined,
              }}
              title={m.meaning}
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              <span className={on ? 'font-medium' : 'text-muted'}>
                {m.label} <span className="tabular-nums">{n}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function PressureStrip({ rollup, stateFilter, onStateFilter }) {
  const moving = (rollup.byState.surging ?? 0) + (rollup.byState.rising ?? 0)
  const coverageLow = rollup.coverage < 0.35

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Figure
          value={moving}
          label="Insights gaining ground"
          sub={`of ${rollup.active} active`}
          tone={moving > 0 ? colors.salmon : undefined}
        />
        <Figure
          value={rollup.recentPosts}
          label={`Posts in last ${rollup.recentDays}d`}
          sub={`${rollup.recentHigh} high priority · ${rollup.recentNegative} negative`}
        />
        <Figure
          value={rollup.coverage}
          format={pct}
          label="Recent discussion explained"
          sub={`${rollup.coveredPosts} of ${rollup.windowPosts} posts`}
          tone={coverageLow ? colors.salmon : colors.mint}
        />
        <Figure
          value={rollup.superseded}
          label="Conclusions superseded"
          sub="replaced by newer analysis"
        />
      </div>

      <div className="mt-5 border-t border-hairline pt-4">
        <StateBar
          byState={rollup.byState}
          total={rollup.active}
          activeFilter={stateFilter}
          onFilter={onStateFilter}
        />
      </div>

      {coverageLow && rollup.windowPosts > 0 && (
        <p
          className="mt-4 rounded-md px-3 py-2 text-caption leading-relaxed"
          style={{ backgroundColor: alpha(colors.salmon, 0.07), color: colors.black }}
        >
          <span className="font-medium">Coverage gap.</span> Most recent discussion isn’t explained
          by any active insight — {rollup.windowPosts - rollup.coveredPosts} posts sit outside every
          insight’s scope. The next analysis cycle has room to find more.
        </p>
      )}
    </div>
  )
}

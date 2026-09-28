// One insight, as a scannable row.
//
// Information order is deliberate and matches how the question is actually
// asked: what is it (type + severity) → is it moving (momentum + sparkline) →
// how big is it (scope) → what is it about (subjects) → the conclusion itself.
// A reader scanning only the top line of each row still learns the state of
// every insight on the page.
import { useRef } from 'react'
import { colors, semantics, alpha, shadows } from '../../theme'
import PillTag from '../PillTag'
import Sparkline from './Sparkline'
import MomentumChip from './MomentumChip'
import { TYPE_LABEL, typeColor, scopeModeOf, compact } from './vocab'

function Stat({ value, label, tone, title }) {
  return (
    <div className="min-w-0" title={title}>
      <p
        className="text-small font-semibold tabular-nums leading-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>
      <p className="text-caption leading-tight text-muted">{label}</p>
    </div>
  )
}

export default function InsightRow({ item, index, selected, onSelect }) {
  const ref = useRef(null)
  const accent = typeColor(item.insightType)
  const sev = semantics.severity[item.severity] ?? colors.blue
  const scopeMode = scopeModeOf(item.scope.mode)
  const stale = item.scope.daysSinceLastPost

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onSelect(item)}
      aria-pressed={selected}
      className="card-lift group w-full rounded-xl border bg-white p-5 text-left transition-colors"
      style={{
        borderColor: selected ? accent : colors.white === '#FFFFFF' ? '#E6EAF0' : '#E6EAF0',
        boxShadow: selected ? shadows.md : shadows.rest,
        // Selected rows get a colour-matched wash so the link between the row
        // and the open panel is spatial, not just implied by position.
        backgroundColor: selected ? alpha(accent, 0.04) : undefined,
      }}
    >
      {/* Line 1 — identity and state. Readable on its own. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="text-caption font-medium uppercase tracking-wide" style={{ color: accent }}>
          {TYPE_LABEL(item.insightType)}
        </span>
        <PillTag color={sev} dot>
          {item.severity}
        </PillTag>
        <MomentumChip state={item.momentum.state} deltaPct={item.momentum.deltaPct} size="sm" />
        {item.lineage.cycles > 1 && (
          <PillTag>
            raised {item.lineage.cycles}×
          </PillTag>
        )}
        <span className="ml-auto text-caption text-muted">
          {stale === null ? 'no dated posts' : stale === 0 ? 'active today' : `${stale}d since last post`}
        </span>
      </div>

      {/* Line 2 — the conclusion. */}
      <h3 className="mt-3 text-h4 font-semibold leading-snug tracking-tight">
        <span className="mr-2 font-light text-muted tabular-nums">{index + 1}.</span>
        {item.title}
      </h3>

      {/* Line 3 — measurements + shape of the trend, side by side. */}
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
          <Stat
            value={compact(item.scope.posts)}
            label={scopeMode.label.toLowerCase() + ' scope'}
            title={scopeMode.note}
          />
          <Stat
            value={item.momentum.recentPosts}
            label={`last ${item.momentum.recentDays}d`}
          />
          <Stat
            value={item.scope.negativePosts}
            label="negative"
            tone={item.scope.negativePosts > 0 ? colors.salmon : undefined}
          />
          <Stat
            value={item.scope.highPriorityPosts}
            label="high priority"
            tone={item.scope.highPriorityPosts > 0 ? colors.midnight : undefined}
          />
          <Stat value={item.evidenceCount} label="cited" />
        </div>
        <div className="hidden shrink-0 sm:block">
          <Sparkline series={item.series} accent={accent} width={168} height={38} />
        </div>
      </div>

      {/* Line 4 — what it is about. */}
      {item.subjects.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
          {item.subjects.slice(0, 5).map((s) => (
            <span
              key={s.key}
              className="rounded-pill px-2 py-0.5 text-caption"
              style={{
                backgroundColor: alpha(s.kind === 'person' ? colors.iris : colors.blue, 0.1),
                color: s.kind === 'person' ? colors.iris : colors.blue,
              }}
              title={s.description || `${s.posts} posts mention ${s.label}`}
            >
              {s.label}
            </span>
          ))}
          <span className="ml-auto text-caption font-medium opacity-0 transition-opacity group-hover:opacity-100" style={{ color: accent }}>
            Open briefing →
          </span>
        </div>
      )}
    </button>
  )
}

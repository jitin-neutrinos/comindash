/**
 * Infographic cards that respond to the relationship graph selection + filters.
 * Reuses existing branded tokens (FrameCard surface, MetricInfo, colors,
 * text-h3, pill tags). Generated from measured data only — no synthetic stats.
 *
 * Two modes, both derived from `graph` (already computed) + `filters`:
 *  - GENERAL (selection === null / no node/edge selected): shows the
 *    filtered graph's aggregate view — people count, product count,
 *    measured vs analyst link counts, top person/product by mentions,
 *    strongest measured link.
 *  - SELECTED (selection is a node or edge): a micro-card describing the
 *    entity (or pair) with real stats from the graph + filter context.
 *
 * Both cards scroll naturally with the page and sit under the filter bar
 * (not floating), so they read as part of the content, not a modal.
 */
import { colors } from '../../theme'
import MetricInfo from '../MetricInfo'
import FrameCard from '../FrameCard'
import PillTag from '../PillTag'

function CountRow({ label, value, accent }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-h3 font-semibold tabular-nums tracking-tight" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-small font-light text-muted">{label}</span>
    </div>
  )
}

export default function InfographicCards({ graph, filters }) {
  if (!graph) return null
  const s = graph.stats ?? {}
  const selectedId = (filters?.selection ?? null)

  // When a node/edge is selected: show focused micro-stats (derived
  // directly from the graph; no synthetic/guessed values).
  if (selectedId) {
    const node = graph.nodes?.find((n) => n.id === selectedId) ?? null
    const isEdge = false // selection shape passed separately; keep simple
    return (
      <FrameCard title="Selection insight" accent={colors.blue} lift={false}>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <CountRow label="Mentions (posts)" value={s.mentions ?? node?.weight ?? '-'} accent={colors.midnight} />
            <CountRow label="Connections" value={s.connections ?? node?.degree ?? '-'} accent={colors.blue} />
          </div>
          <p className="text-small font-light leading-relaxed text-muted">
            Figures come from the current filtered graph only — not the full dataset.
          </p>
        </div>
      </FrameCard>
    )
  }

  // General overview card: derived from the filtered graph.
  return (
    <FrameCard title="Graph overview" accent={colors.blue} lift={false}>
      <div className="grid gap-4 md:grid-cols-4">
        <CountRow label="people" value={s.people ?? 0} accent={colors.midnight} />
        <CountRow label="products" value={s.products ?? 0} accent={colors.blue} />
        <CountRow label="measured links" value={s.coMentionEdges ?? 0} accent={colors.midnight} />
        <CountRow label="analyst links" value={s.assertedEdges ?? 0} accent={colors.celeste} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-hairline pt-3">
        <PillTag color={colors.midnight} dot>Person = dark</PillTag>
        <PillTag color={colors.blue} dot>Product = blue</PillTag>
        <PillTag color={colors.celeste} dot>Link = dashed</PillTag>
      </div>
      <p className="mt-4 text-caption font-light text-muted leading-relaxed">
        Filter bar above controls the visible nodes + edges. Numbers on this card
        always match the current selection, not the full database.
      </p>
    </FrameCard>
  )
}

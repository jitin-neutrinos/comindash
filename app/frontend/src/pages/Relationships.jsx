import { useEffect, useMemo, useState } from 'react'
import { getRelationshipGraph, useApi } from '../api'
import { alpha, colors } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import { GraphSkeleton } from '../components/Skeletons'
import KnowledgeGraph, { AdjacencyTable, kindStyle } from '../components/graph/KnowledgeGraph'
import InsightPanel from '../components/graph/InsightPanel'

const DENSITY = [
  { id: 'focused', label: 'Focused', minEdge: 6, maxPeople: 14, hint: 'Only the strongest links' },
  { id: 'balanced', label: 'Balanced', minEdge: 3, maxPeople: 24, hint: 'The working view' },
  { id: 'complete', label: 'Complete', minEdge: 2, maxPeople: 40, hint: 'Every link we found' },
]

function StatBlock({ value, label, color }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-h3 font-semibold tabular-nums leading-none tracking-tight">{value}</span>
      <span className="text-small font-light text-muted">{label}</span>
    </div>
  )
}

export default function Relationships() {
  const page = usePageChoreo([])
  const [densityId, setDensityId] = useState('balanced')
  const [selection, setSelection] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const density = DENSITY.find((d) => d.id === densityId) ?? DENSITY[1]
  const fetcher = useMemo(
    () => () => getRelationshipGraph({ minEdge: density.minEdge, maxPeople: density.maxPeople }),
    [density.minEdge, density.maxPeople],
  )
  const { data: graph, loading, error } = useApi(fetcher, { deps: [densityId] })

  // A selection that no longer exists in the current density must not keep the
  // panel open on a phantom entity.
  useEffect(() => {
    if (!selection || !graph) return
    const ids = new Set(graph.nodes.map((n) => n.id))
    if (!selection.keys.every((k) => ids.has(k))) setSelection(null)
  }, [graph]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = graph?.stats ?? {}

  return (
    <div ref={page} className="space-y-6">
      {/* --- header ------------------------------------------------------- */}
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-5">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Relationship map</h1>
            <MetricInfo metricKey="relationshipsPage" />
          </div>
          <p className="mt-1.5 font-light leading-relaxed text-muted">
            Who works on what, and which parts of the platform come up together. Solid links are
            measured from the posts themselves; dashed links are the analyst's own reading. Click
            anything for a briefing written from the real posts underneath it.
          </p>
        </div>

        {/* Density control — a segmented control, not a slider: three named
            states a reader can reason about beat an anonymous number. */}
        <div
          className="flex rounded-pill border border-line bg-surface p-1"
          role="radiogroup"
          aria-label="Map detail"
        >
          {DENSITY.map((d) => {
            const on = d.id === densityId
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                title={d.hint}
                onClick={() => setDensityId(d.id)}
                className={`rounded-pill px-3.5 py-1.5 text-small transition-colors ${
                  on ? 'bg-blue font-medium text-white' : 'font-light text-muted hover:text-midnight'
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </header>

      {/* --- measured summary --------------------------------------------- */}
      <div
        data-anim="row"
        className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-line bg-surface px-6 py-4"
      >
        <StatBlock value={stats.people ?? 0} label="people" color={colors.midnight} />
        <StatBlock value={stats.products ?? 0} label="products" color={colors.blue} />
        <StatBlock value={stats.coMentionEdges ?? 0} label="measured links" color={alpha(colors.blue, 0.45)} />
        <StatBlock value={stats.assertedEdges ?? 0} label="analyst links" color={colors.celeste} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {Object.entries(kindStyle()).map(([kind, s]) => (
            <PillTag key={kind} color={s.fill} dot>
              {s.label}
            </PillTag>
          ))}
        </div>
      </div>

      {/* --- map + panel ---------------------------------------------------- */}
      <div data-anim="chart" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <FrameCard
          title="Connection map"
          accent={colors.blue}
          lift={false}
          infoKey="connectionMap"
          className="min-w-0"
          action={
            selection ? (
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="text-small font-light text-blue transition-colors hover:text-midnight"
              >
                Clear selection
              </button>
            ) : undefined
          }
        >
          {loading && <GraphSkeleton height={620} />}
          {!loading && error && (
            <div className="flex h-[620px] items-center justify-center">
              <p className="text-small font-light text-muted">Could not load the map: {error.message ?? String(error)}</p>
            </div>
          )}
          {!loading && !error && (
            <KnowledgeGraph
              graph={graph}
              selection={selection}
              onSelect={setSelection}
              height={620}
            />
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
            <p className="text-caption font-light leading-relaxed text-muted">
              Dot size = how often it is mentioned. Line thickness = how many posts the pair share.
              Dashed = the analyst's asserted relationship.
            </p>
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-expanded={showTable}
              className="shrink-0 text-caption font-light text-blue transition-colors hover:text-midnight"
            >
              {showTable ? 'Hide' : 'Show'} connections as a list
            </button>
          </div>
        </FrameCard>

        <div className="min-h-[560px] lg:sticky lg:top-6 lg:h-[calc(100vh-6rem)]">
          <InsightPanel
            selection={selection}
            graph={graph}
            onSelect={setSelection}
            onClose={() => setSelection(null)}
          />
        </div>
      </div>

      {/* --- accessible/scannable list view --------------------------------- */}
      {showTable && (
        <div data-anim="row">
          <FrameCard title="All connections" accent={colors.blue} lift={false}>
            <AdjacencyTable graph={graph} onSelect={setSelection} limit={60} />
          </FrameCard>
        </div>
      )}
    </div>
  )
}

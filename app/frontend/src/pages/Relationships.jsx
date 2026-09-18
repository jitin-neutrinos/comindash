import { getRelationships, useApi } from '../api'
import { colors } from '../theme'
import { usePageChoreo } from '../motion'
import FrameCard from '../components/FrameCard'
import MetricInfo from '../components/MetricInfo'
import PillTag from '../components/PillTag'
import RelationshipMap from '../components/charts/RelationshipMap'

export default function Relationships() {
  const page = usePageChoreo([])
  const { data: graph, loading } = useApi(getRelationships)
  const typeCounts = (graph?.nodes ?? []).reduce((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div ref={page} className="space-y-8">
      <header data-anim="header" className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h2 font-semibold tracking-tight">Relationships</h1>
            <MetricInfo metricKey="relationshipsPage" />
          </div>
          <p className="mt-1 font-light text-muted">
            Entities and topics the assistant linked across community discussion.
          </p>
        </div>
        {graph && (
          <div className="flex gap-2">
            <PillTag>{graph.nodes.length} entities</PillTag>
            <PillTag>{graph.links.length} links</PillTag>
          </div>
        )}
      </header>

      <div data-anim="chart">
        <FrameCard
          title="Connection map"
          accent={colors.blue}
          lift={false}
          infoKey="connectionMap"
          action={
            graph ? (
              <div className="flex flex-wrap gap-2">
                {Object.entries(typeCounts).map(([type, count]) => (
                  <PillTag key={type}>
                    {type} ({count})
                  </PillTag>
                ))}
              </div>
            ) : undefined
          }
        >
          <RelationshipMap graph={graph} loading={loading} />
          <p className="mt-4 text-caption font-light text-muted">
            Link weight encodes relationship strength. Hover a node or link for details.
          </p>
        </FrameCard>
      </div>
    </div>
  )
}

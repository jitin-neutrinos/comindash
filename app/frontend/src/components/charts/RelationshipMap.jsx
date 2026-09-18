import { useLayoutEffect, useRef } from 'react'
import { alpha, colors } from '../../theme'
import { gsap } from '../../motion'
import { ChartSkeleton } from '../Skeletons'
import { ChartEmpty } from './chartKit'
import { layoutGraph } from './relationshipLayout'

const TYPE_COLORS = {
  entity: colors.blue,
  topic: colors.celeste,
  insight: colors.iris,
  focus: colors.salmon,
}

/**
 * SVG circle-link graph from /api/relationships, and the mini hub-and-spoke
 * map inside the info panels.
 *
 * Text safety (see relationshipLayout.js + its self-check): labels sit on a
 * ring outside every dot, links are trimmed back to the dot's edge, and each
 * label is painted with a white outline underneath — so no line, and no
 * circle, ever cuts through a word.
 */
export default function RelationshipMap({ graph, loading, height = 520, width = 800, pad = 90 }) {
  const root = useRef(null)
  const nodes = graph?.nodes ?? []
  const links = graph?.links ?? []

  useLayoutEffect(() => {
    const el = root.current
    if (!el || !nodes.length) return undefined
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline()
      tl.fromTo(
        el.querySelectorAll('.rel-node'),
        { autoAlpha: 0, scale: 0.5, transformOrigin: '50% 50%' },
        { autoAlpha: 1, scale: 1, duration: 0.5, stagger: 0.04, ease: 'back.out(1.6)' },
        0.1,
      )
      tl.fromTo(
        el.querySelectorAll('.rel-link'),
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.5, stagger: 0.02 },
        0.3,
      )
      return () => tl.kill()
    })
    return () => mm.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  if (loading) return <ChartSkeleton height={height} />
  if (!nodes.length) return <ChartEmpty height={height} />

  const { placed, edges, fontSize } = layoutGraph(nodes, links, { width, height, pad })

  return (
    <div
      ref={root}
      className="w-full"
      role="img"
      aria-label={`Relationship graph: ${placed.length} entities, ${links.length} links`}
    >
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ maxHeight: height + 40 }}>
        {edges.map((e, i) => (
          <line
            key={i}
            className="rel-link"
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={alpha(colors.blue, 0.15 + 0.65 * Math.min(e.raw.strength, 1))}
            strokeWidth={1 + 2.5 * Math.min(e.raw.strength, 1)}
            strokeLinecap="round"
          >
            <title>
              {`${e.raw.source.value ?? e.raw.source.id} ${e.raw.relation} ${e.raw.target.value ?? e.raw.target.id} (strength ${e.raw.strength.toFixed(2)})`}
            </title>
          </line>
        ))}
        {placed.map((n) => (
          <g key={n.id} className="rel-node">
            <circle cx={n.x} cy={n.y} r={n.r} fill={TYPE_COLORS[n.type] ?? colors.blue}>
              <title>{`${n.type}: ${n.value} (weight ${n.weight})`}</title>
            </circle>
            {n.label && (
              <text
                x={n.label.x}
                y={n.label.y}
                textAnchor={n.label.anchor}
                fontSize={fontSize}
                fill={colors.midnight}
                stroke={colors.white}
                strokeWidth={3}
                strokeLinejoin="round"
                style={{ paintOrder: 'stroke' }}
              >
                {n.label.text}
                <title>{n.value}</title>
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

// Weekly activity sparkline for one insight's scope.
//
// Deliberately not a charting-library chart: it renders inside a list row at
// ~180x40, has no axes, and needs a draw-on animation the library would fight.
// Two layers — total posts as an area, negative posts as a line on top — so
// the eye reads "how much" and "how bad" in the same glance.
import { useLayoutEffect, useMemo, useRef } from 'react'
import { colors, alpha } from '../../theme'
import { gsap, canAnimateEntrance } from '../../motion'

/** Catmull-Rom → cubic Bézier. Smooths the line without overshooting data. */
function smoothPath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

export default function Sparkline({
  series = [],
  width = 180,
  height = 40,
  accent = colors.blue,
  showNegative = true,
  animate = true,
}) {
  const lineRef = useRef(null)
  const areaRef = useRef(null)
  const negRef = useRef(null)
  const dotRef = useRef(null)

  const geom = useMemo(() => {
    const pts = series.map((p) => Number(p.posts) || 0)
    if (pts.length < 2) return null
    const pad = 3
    const max = Math.max(...pts, 1)
    const stepX = (width - pad * 2) / (pts.length - 1)
    const y = (v) => height - pad - (v / max) * (height - pad * 2)
    const coords = pts.map((v, i) => ({ x: pad + i * stepX, y: y(v) }))
    const negCoords = series.map((p, i) => ({
      x: pad + i * stepX,
      y: y(Number(p.negative) || 0),
    }))
    const line = smoothPath(coords)
    return {
      line,
      area: `${line} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`,
      neg: smoothPath(negCoords),
      last: coords[coords.length - 1],
      max,
    }
  }, [series, width, height])

  useLayoutEffect(() => {
    if (!geom || !animate || !canAnimateEntrance()) return undefined
    const line = lineRef.current
    if (!line) return undefined
    const len = line.getTotalLength?.() ?? 0
    const tl = gsap.timeline()
    if (len) {
      // Draw the line left-to-right — time reads as motion along the x axis.
      gsap.set(line, { strokeDasharray: len, strokeDashoffset: len })
      tl.to(line, { strokeDashoffset: 0, duration: 0.7, ease: 'power2.out' })
    }
    if (areaRef.current) {
      tl.fromTo(areaRef.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.2)
    }
    if (negRef.current) {
      const nlen = negRef.current.getTotalLength?.() ?? 0
      if (nlen) {
        gsap.set(negRef.current, { strokeDasharray: nlen, strokeDashoffset: nlen })
        tl.to(negRef.current, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' }, 0.15)
      }
    }
    if (dotRef.current) {
      tl.fromTo(
        dotRef.current,
        { scale: 0, transformOrigin: '50% 50%' },
        { scale: 1, duration: 0.3, ease: 'back.out(2)' },
        0.6,
      )
    }
    // progress(1) before kill: a sparkline killed mid-draw would keep its
    // strokeDashoffset and render as a half-drawn line.
    return () => tl.progress(1).kill()
  }, [geom, animate])

  if (!geom) {
    return (
      <div
        className="flex items-center justify-center text-caption text-muted"
        style={{ width, height }}
      >
        not enough history
      </div>
    )
  }

  const gid = `spark-${accent.replace('#', '')}`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Weekly activity, peak ${geom.max} posts in a week`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path ref={areaRef} d={geom.area} fill={`url(#${gid})`} />
      <path
        ref={lineRef}
        d={geom.line}
        fill="none"
        stroke={accent}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showNegative && (
        <path
          ref={negRef}
          d={geom.neg}
          fill="none"
          stroke={alpha(colors.salmon, 0.75)}
          strokeWidth="1.25"
          strokeDasharray="2 2.5"
          strokeLinecap="round"
        />
      )}
      <circle ref={dotRef} cx={geom.last.x} cy={geom.last.y} r="2.75" fill={accent} />
    </svg>
  )
}

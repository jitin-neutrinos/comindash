// Premium surface primitives shared by Overview and InsightDetail.
//
// Design intent (brand-core first, agency polish second):
//   * White + Neutrinos Blue dominate; exactly ONE accent per view.
//   * Depth comes from a nested "double-bezel" frame and diffused ambient
//     shadow, never from a hard 1px grey box or a harsh drop shadow.
//   * One easing across every interactive surface, so the whole app feels
//     like one piece of hardware: cubic-bezier(0.16, 1, 0.3, 1).
//
// Deliberately NOT adopted from the premium-aesthetic playbook: its Korean
// typography rules, Pretendard font and Vantablack palette, all of which
// contradict Neutrinos brand-core (Poppins, White/Blue dominant, light).
import { alpha, colors } from '../theme'

/** The app's single motion signature. */
export const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
export const transition = (props = 'all', ms = 420) => `${props} ${ms}ms ${EASE}`

/** Ambient elevation — wide, soft and low-opacity. Never a hard dark shadow. */
export const ambient = {
  rest: `0 1px 2px ${alpha(colors.midnight, 0.04)}, 0 12px 32px -18px ${alpha(colors.midnight, 0.14)}`,
  lift: `0 2px 4px ${alpha(colors.midnight, 0.05)}, 0 24px 48px -20px ${alpha(colors.midnight, 0.22)}`,
}

/**
 * Double-bezel surface: an outer tray holding an inner plate, like machined
 * hardware. The inner radius is computed from the outer so the corners stay
 * concentric instead of looking like two unrelated rounded boxes.
 */
export function Bezel({
  accent = colors.blue,
  radius = 20,
  pad = 5,
  lift = false,
  className = '',
  innerClassName = '',
  style,
  children,
  as: Tag = 'div',
  ...rest
}) {
  return (
    <Tag
      // `bezel-lift` is a single global rule in index.css — a per-instance
      // <style> tag would duplicate the same CSS once per card on screen.
      className={`relative ${lift ? 'bezel-lift' : ''} ${className}`}
      style={{
        borderRadius: radius,
        padding: pad,
        background: `linear-gradient(160deg, ${alpha(accent, 0.13)}, ${alpha(colors.midnight, 0.045)} 62%)`,
        boxShadow: ambient.rest,
        transition: transition('box-shadow, transform'),
        ...style,
      }}
      {...rest}
    >
      <div
        className={`relative h-full overflow-hidden bg-white ${innerClassName}`}
        style={{
          borderRadius: radius - pad,
          boxShadow: `inset 0 1px 0 ${alpha(colors.white, 0.9)}, inset 0 0 0 1px ${alpha(colors.midnight, 0.055)}`,
        }}
      >
        {children}
      </div>
    </Tag>
  )
}

/**
 * Eyebrow: a microscopic tag above a heading. Carries the section's accent at
 * low opacity so the hierarchy reads before any text is parsed.
 */
export function Eyebrow({ children, color = colors.blue, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.16em] ${className}`}
      style={{ backgroundColor: alpha(color, 0.1), color }}
    >
      {children}
    </span>
  )
}

/**
 * Directional delta chip. `polarity` decides whether up is good: post volume
 * rising is neutral-positive, high-priority rising is bad. Colour must follow
 * meaning, not arithmetic sign.
 */
export function DeltaChip({ delta, polarity = 'neutral', label }) {
  if (!delta) return null
  const { direction, pct, value, previous } = delta
  if (direction === 'flat') {
    return (
      <span className="inline-flex items-center gap-1 text-caption font-light text-muted">
        <span aria-hidden="true">—</span> level
      </span>
    )
  }
  const up = direction === 'up'
  const bad = polarity === 'inverse' ? up : polarity === 'normal' ? !up : false
  const good = polarity === 'inverse' ? !up : polarity === 'normal' ? up : false
  const color = bad ? colors.salmon : good ? colors.mint : colors.blue
  // No baseline => no percentage. Show the raw move instead of inventing one.
  const text =
    pct === null || pct === undefined
      ? `${up ? '+' : ''}${Math.round(value - previous)}`
      : `${pct > 0 ? '+' : ''}${Math.round(pct * 100)}%`
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-medium tabular-nums"
      style={{ backgroundColor: alpha(color, 0.11), color }}
      title={
        label
          ? `${label}: ${Math.round(value)} in the last ${delta.window_days} days vs ${Math.round(previous)} in the ${delta.window_days} before`
          : undefined
      }
    >
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      {text}
    </span>
  )
}

/** Section heading with eyebrow + optional trailing action. */
export function SectionHead({ eyebrow, title, action, accent = colors.blue, info }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <Eyebrow color={accent}>{eyebrow}</Eyebrow>}
        <div className="mt-2 flex items-center gap-2">
          <h2 className="text-h4 font-semibold leading-tight tracking-tight">{title}</h2>
          {info}
        </div>
      </div>
      {action}
    </div>
  )
}

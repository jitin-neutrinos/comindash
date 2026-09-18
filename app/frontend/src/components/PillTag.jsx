import { alpha, colors } from '../theme'

/**
 * Brand pill tag — fully rounded, tinted surface with optional color dot.
 * Color values come from theme.js (brand tokens); never inline hex.
 */
export default function PillTag({ children, color, dot = false, className = '' }) {
  const tint = color ? { backgroundColor: alpha(color, 0.12) } : undefined
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-small font-medium ${
        color ? '' : 'bg-mist'
      } ${className}`}
      style={tint}
    >
      {dot && color && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </span>
  )
}

/** Default accent pill (Celeste on white — brand section-tag treatment). */
export function AccentPill({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-3 py-1 text-small font-medium ${className}`}
      style={{ backgroundColor: colors.celeste, color: colors.black }}
    >
      {children}
    </span>
  )
}

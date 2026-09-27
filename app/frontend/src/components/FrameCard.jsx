import { colors } from '../theme'
import MetricInfo from './MetricInfo'

/**
 * Premium white card — 1px border, 12–16px radius, refined frame-bracket
 * accent: a thin 2px left rule (Neutrinos Blue by default, accent on
 * insight cards). Soft shadow appears only on hover lift (`lift`).
 *
 * `infoKey` adds the shared "what is this?" affordance beside the title, so a
 * card explains itself without every page hand-rolling one.
 */
export default function FrameCard({
  title,
  action,
  accent = colors.blue,
  lift = true,
  infoKey,
  children,
  className = '',
  as: Tag = 'section',
}) {
  return (
    <Tag
      className={`${lift ? 'card-lift' : ''} rounded-2xl border border-line bg-white py-6 pl-7 pr-6 ${className}`}
    >
      {(title || action || infoKey) && (
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {title && <h2 className="text-h4 font-semibold tracking-tight">{title}</h2>}
            {infoKey && <MetricInfo metricKey={infoKey} accent={accent} />}
          </div>
          {action}
        </header>
      )}
      {children}
    </Tag>
  )
}

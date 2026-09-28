// Pagination for long lists.
//
// Renders nothing below the threshold — a pager under a 6-item list is chrome
// that costs a reader attention and buys nothing. Page numbers collapse to an
// ellipsis window so the control stays one line at any list length.
import { alpha, colors } from '../theme'

/**
 * Page numbers to render, with `null` marking a gap.
 * Always shows first and last so a reader can jump to either end in one click,
 * and keeps a window around the current page so the neighbours are reachable.
 */
export function pageWindow(current, total, span = 1) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = new Set([1, total, current])
  for (let d = 1; d <= span; d += 1) {
    if (current - d > 1) pages.add(current - d)
    if (current + d < total) pages.add(current + d)
  }
  // Widen the window at the ends so the control keeps a stable width instead
  // of shrinking when the reader is on page 1 or the last page.
  if (current <= 3) [2, 3, 4].forEach((p) => p < total && pages.add(p))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => p > 1 && pages.add(p))

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) out.push(null)
    out.push(p)
    prev = p
  }
  return out
}

export default function Pagination({
  page,
  pageCount,
  onChange,
  total,
  perPage,
  label = 'items',
}) {
  if (pageCount <= 1) return null

  const from = (page - 1) * perPage + 1
  const to = Math.min(page * perPage, total)
  const go = (p) => onChange(Math.min(Math.max(p, 1), pageCount))

  const btn =
    'flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-small font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4"
      aria-label="Pagination"
    >
      <p className="text-caption text-muted tabular-nums">
        {from}–{to} of {total} {label}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={`${btn} text-muted hover:bg-hairline hover:text-black`}
          onClick={() => go(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
        >
          ←
        </button>

        {pageWindow(page, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-caption text-muted" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${btn} ${p === page ? '' : 'text-muted hover:bg-hairline hover:text-black'}`}
              style={
                p === page
                  ? { backgroundColor: alpha(colors.blue, 0.12), color: colors.blue }
                  : undefined
              }
              onClick={() => go(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          className={`${btn} text-muted hover:bg-hairline hover:text-black`}
          onClick={() => go(page + 1)}
          disabled={page === pageCount}
          aria-label="Next page"
        >
          →
        </button>
      </div>
    </nav>
  )
}

// The state chip: the single most important glyph on the page. It is what
// turns "the analyst concluded X" into "X is getting worse right now".
//
// Emil: a chip that encodes state must survive being read in isolation, so it
// carries the word, not just a colour — colour alone fails for ~8% of men and
// for anyone scanning a greyscale print of the dashboard.
import { useRef } from 'react'
import { alpha } from '../../theme'
import { momentumOf, deltaLabel } from './vocab'
import { usePulse } from '../../motion'

export default function MomentumChip({ state, deltaPct, size = 'md', pulse = false }) {
  const dot = useRef(null)
  const m = momentumOf(state)
  const delta = deltaLabel(deltaPct)
  // Pulse only for states that genuinely demand attention, and only when the
  // caller opts in — a page of pulsing chips is noise, not signal.
  usePulse(dot, pulse && (state === 'surging' || state === 'rising'))

  const pad = size === 'sm' ? 'px-2 py-0.5 text-caption' : 'px-2.5 py-1 text-small'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill font-medium ${pad}`}
      style={{ backgroundColor: alpha(m.color, 0.12), color: m.color }}
      title={m.meaning}
    >
      <span
        ref={dot}
        aria-hidden="true"
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, backgroundColor: m.color }}
      />
      {m.label}
      {delta && (
        <span className="tabular-nums" style={{ color: alpha(m.color, 0.85) }}>
          {delta}
        </span>
      )}
    </span>
  )
}

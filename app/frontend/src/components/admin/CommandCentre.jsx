// Admin → Command centre: is the system up, and is work flowing through it?
//
// Two questions, answered in that order. Everything here is measured from the
// database and live probes — nothing is assumed. Where a signal genuinely
// cannot be obtained (the API container cannot see Docker), the card says so
// rather than guessing a green light.
import { getSystem, relTime, useApi } from '../../api'
import { alpha, colors } from '../../theme'
import { usePulseAll } from '../../motion'
import { Bezel, Eyebrow, SectionHead } from '../Surface'
import { MetricSkeleton, RowsSkeleton } from '../Skeletons'
import { STATE_TONE, StatusDot, pct, seenLabel } from '../review/ReviewKit'
import { useRef } from 'react'

const OVERALL_COPY = {
  ok: 'All services are up and answering.',
  idle: 'Everything is up. The work queue is empty, so the system is resting.',
  warn: 'Everything is running, but at least one part is underperforming. Details below.',
  down: 'Something the dashboard depends on is not responding. Details below.',
  unknown: 'Status could not be determined.',
}

// One honest sentence per state, rendered as text — not a badge.
const SERVICE_STATE_COPY = {
  ok: 'Working normally.',
  idle: 'Resting. Nothing to do right now.',
  warn: 'Running, but with a problem. Details below.',
  down: 'Not responding.',
  unknown: 'Status unknown.',
}

function ServiceCard({ svc }) {
  const tone = STATE_TONE[svc.state] ?? STATE_TONE.unknown
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: alpha(tone, 0.055),
        boxShadow: `inset 0 0 0 1px ${alpha(tone, 0.16)}`,
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot state={svc.state} pulse />
        <p className="truncate text-small font-semibold">{svc.label}</p>
      </div>
      <p className="mt-1.5 text-caption font-light leading-snug text-muted">{svc.role}</p>
      <p className="mt-2 text-caption font-light leading-snug">
        <span className="font-medium" style={{ color: tone }}>
          {svc.state === 'ok' || svc.state === 'idle' ? '' : `${svc.state.charAt(0).toUpperCase()}${svc.state.slice(1)}. `}
        </span>
        {svc.reason ?? SERVICE_STATE_COPY[svc.state] ?? SERVICE_STATE_COPY.unknown}
      </p>
      {svc.note && (
        <p className="mt-1.5 text-caption font-light leading-snug text-muted">{svc.note}</p>
      )}
    </div>
  )
}

function StageCard({ stage }) {
  const tone = STATE_TONE[stage.state] ?? STATE_TONE.unknown
  const total = stage.runs24h.done + stage.runs24h.failed
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: alpha(tone, 0.05),
        boxShadow: `inset 0 0 0 1px ${alpha(tone, 0.14)}`,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot state={stage.state} pulse />
          <p className="text-small font-semibold">{stage.label}</p>
        </div>
        <p
          className="text-h4 font-semibold leading-none tabular-nums"
          style={{ color: stage.successRate24h === null ? undefined : tone }}
          title="Share of runs that finished cleanly, over the last 24 hours"
        >
          {stage.successRate24h === null ? '—' : pct(stage.successRate24h, 0)}
        </p>
      </div>
      <p className="mt-1.5 text-caption font-light leading-snug text-muted">
        {stage.description}
      </p>
      <p className="mt-2.5 text-caption font-light leading-snug">
        {stage.lastFinishedAt ? (
          <>Last finished {relTime(stage.lastFinishedAt)}</>
        ) : (
          'Has not run yet.'
        )}
        {total > 0 && (
          <span className="text-muted">
            {' '}· {stage.runs24h.done} finished
            {stage.runs24h.failed > 0 ? `, ${stage.runs24h.failed} failed` : ''} today
          </span>
        )}
      </p>
      {stage.lastError && (
        <p
          className="mt-2 rounded-sm px-2 py-1.5 text-caption font-light leading-snug"
          style={{ backgroundColor: alpha(colors.salmon, 0.1) }}
        >
          {stage.lastError}
        </p>
      )}
    </div>
  )
}

export default function CommandCentre() {
  const { data, loading, error } = useApi(getSystem, { intervalMs: 30000 })
  const root = useRef(null)
  usePulseAll(root, '[data-pulse]', [data, loading])

  if (error) {
    return (
      <Bezel accent={colors.salmon}>
        <div className="p-6">
          <p className="text-small font-semibold">Could not read system status.</p>
          <p className="mt-1 text-small font-light text-muted">{error.message}</p>
        </div>
      </Bezel>
    )
  }

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
        <RowsSkeleton rows={3} />
      </div>
    )
  }

  const tone = STATE_TONE[data.overall] ?? STATE_TONE.unknown

  return (
    <div ref={root} className="space-y-8">
      {/* --- overall ------------------------------------------------------ */}
      <Bezel accent={tone} radius={20} pad={5} data-anim="kpi">
        <div className="flex flex-wrap items-center justify-between gap-5 p-6">
          <div className="flex items-center gap-4">
            <StatusDot state={data.overall} pulse size={14} />
            <div>
              <Eyebrow color={tone}>System</Eyebrow>
              <p className="mt-2 text-h3 font-semibold capitalize leading-none tracking-tight">
                {data.overall}
              </p>
              <p className="mt-1.5 text-small font-light text-muted">
                {OVERALL_COPY[data.overall] ?? OVERALL_COPY.unknown}
              </p>
            </div>
          </div>
        </div>
      </Bezel>


      {/* --- services ------------------------------------------------------ */}
      <section data-anim="row">
        <SectionHead
          title="The moving parts"
          action={
            <p className="text-caption font-light text-muted">
              Refreshes every 30s · read {data.generatedAt ? relTime(data.generatedAt) : '—'}
            </p>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.services.map((s) => (
            <ServiceCard key={s.key} svc={s} />
          ))}
        </div>
      </section>

      {/* --- worker -------------------------------------------------------- */}
      <section data-anim="row">
        <SectionHead title="The workhorse, right now" />
        <Bezel accent={STATE_TONE[data.queue.workerState] ?? colors.blue} radius={18} pad={4}>
          <div className="flex flex-wrap items-center justify-between gap-5 p-5">
            <div className="flex items-center gap-3">
              <StatusDot state={data.queue.workerState} pulse size={11} />
              <div>
                <p className="text-small font-semibold capitalize">{data.queue.workerState}</p>
                <p className="mt-0.5 text-caption font-light text-muted">
                  {data.queue.workerReason}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-h4 font-semibold leading-none tabular-nums">{data.queue.pending}</p>
                <p className="mt-1 text-caption font-light text-muted">waiting in line</p>
              </div>
              <div>
                <p className="text-h4 font-semibold leading-none tabular-nums">{data.queue.running}</p>
                <p className="mt-1 text-caption font-light text-muted">being worked on</p>
              </div>
              <div>
                <p
                  className="text-h4 font-semibold leading-none tabular-nums"
                  style={{ color: data.queue.dead ? colors.salmon : undefined }}
                >
                  {data.queue.dead}
                </p>
                <p className="mt-1 text-caption font-light text-muted">gave up after retries</p>
              </div>
              <div>
                <p className="text-h4 font-semibold leading-none tabular-nums">{data.counts.posts24h.toLocaleString()}</p>
                <p className="mt-1 text-caption font-light text-muted">new posts today</p>
              </div>
            </div>
          </div>
        </Bezel>
      </section>

      {/* --- pipeline ------------------------------------------------------ */}
      <section data-anim="row">
        <SectionHead
          title="How a post becomes an insight"
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {data.stages.map((s) => (
            <StageCard key={s.key} stage={s} />
          ))}
        </div>
      </section>
    </div>
  )
}

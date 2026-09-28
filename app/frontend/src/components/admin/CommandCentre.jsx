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
import { STATE_TONE, StatusDot, Stat, pct, seenLabel } from '../review/ReviewKit'
import { useRef } from 'react'

const OVERALL_COPY = {
  ok: 'All services responding.',
  idle: 'All services responding; queue is empty.',
  warn: 'Running, with one or more degraded services.',
  down: 'A service the pipeline depends on is not responding.',
  unknown: 'Status could not be determined.',
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={svc.state} pulse />
            <p className="truncate text-small font-semibold">{svc.label}</p>
          </div>
          <p className="mt-1 text-caption font-light leading-snug text-muted">{svc.role}</p>
        </div>
        <span
          className="shrink-0 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{ backgroundColor: alpha(tone, 0.16), color: tone }}
        >
          {svc.state}
        </span>
      </div>

      {svc.models.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {svc.models.map((m) => (
            <li key={m.name} className="flex items-center gap-1.5 text-caption font-light">
              <StatusDot state={m.loaded ? 'ok' : 'down'} size={6} />
              <span className="capitalize">{m.name}</span>
              <span className="text-muted">{m.loaded ? 'loaded' : 'not loaded'}</span>
            </li>
          ))}
        </ul>
      )}

      {svc.lastActivity && (
        <p className="mt-2 text-caption font-light text-muted">
          Last activity {seenLabel(svc.lastActivity)}
        </p>
      )}
      {svc.reason && <p className="mt-2 text-caption font-light leading-snug">{svc.reason}</p>}
      {svc.note && (
        <p className="mt-2 text-caption font-light leading-snug text-muted">{svc.note}</p>
      )}
      {svc.container && (
        <code className="mt-2 inline-block rounded-sm bg-mist px-1.5 py-0.5 text-caption">
          {svc.container}
        </code>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot state={stage.state} pulse />
            <p className="text-small font-semibold">{stage.label}</p>
          </div>
          <p className="mt-1 text-caption font-light leading-snug text-muted">
            {stage.description}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="text-h4 font-semibold leading-none tabular-nums"
            style={{ color: stage.successRate24h === null ? undefined : tone }}
          >
            {stage.successRate24h === null ? '—' : pct(stage.successRate24h, 0)}
          </p>
          <p className="mt-0.5 text-caption font-light text-muted">
            {total ? `${total} runs / 24h` : 'no runs in 24h'}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Done 24h" value={stage.runs24h.done} />
        <Stat
          label="Failed 24h"
          value={stage.runs24h.failed}
          tone={stage.runs24h.failed ? colors.salmon : undefined}
        />
        <Stat
          label="All-time"
          value={stage.successRateAll === null ? '—' : pct(stage.successRateAll, 0)}
        />
      </div>

      {stage.lastStats.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
          {stage.lastStats.slice(0, 6).map((s) => (
            <li key={s.key} className="text-caption font-light">
              <span className="font-medium">{s.key.replace(/_/g, ' ')}</span>:{' '}
              <span className="tabular-nums">{s.value}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-caption font-light text-muted">
        Last run {stage.lastStatus || 'unknown'}
        {stage.lastFinishedAt ? ` · finished ${relTime(stage.lastFinishedAt)}` : ''}
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
          <div className="grid grid-cols-3 gap-6">
            <Stat label="Queue pending" value={data.queue.pending} />
            <Stat
              label="Running"
              value={data.queue.running}
              tone={data.queue.running ? colors.blue : undefined}
            />
            <Stat
              label="Dead-letter"
              value={data.queue.dead}
              tone={data.queue.dead ? colors.salmon : undefined}
              hint={data.queue.dead ? 'exhausted retries' : undefined}
            />
          </div>
        </div>
      </Bezel>

      {/* --- services ------------------------------------------------------ */}
      <section data-anim="row">
        <SectionHead
          eyebrow="Containers & services"
          title="Moving parts"
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
        <SectionHead eyebrow="Workers" title="Background worker" />
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
            <p className="text-caption font-light text-muted">
              Last claim {seenLabel(data.queue.workerLastActivity)}
            </p>
          </div>
          {data.queue.byKind.length > 0 && (
            <div className="border-t px-5 py-4" style={{ borderColor: alpha(colors.midnight, 0.07) }}>
              <p className="mb-2 text-caption font-medium uppercase tracking-wider text-muted">
                Queue by job kind
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                {data.queue.byKind.map((k) => (
                  <li key={k.kind} className="text-caption font-light">
                    <span className="font-medium capitalize">{k.kind}</span>:{' '}
                    {k.counts.map((c, i) => (
                      <span key={c.status}>
                        {i > 0 && ', '}
                        <span className="tabular-nums">{c.count}</span> {c.status}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Bezel>
      </section>

      {/* --- pipeline ------------------------------------------------------ */}
      <section data-anim="row">
        <SectionHead
          eyebrow="Pipeline"
          title="Ingestion → prediction → extraction → analysis"
        />
        <div className="grid gap-4 lg:grid-cols-3">
          {data.stages.map((s) => (
            <StageCard key={s.key} stage={s} />
          ))}
        </div>
      </section>

      {/* --- data volumes --------------------------------------------------- */}
      <section data-anim="row">
        <SectionHead eyebrow="Data" title="What is in the system" />
        <Bezel accent={colors.blue} radius={18} pad={4}>
          <div className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Posts" value={data.counts.posts.toLocaleString()} />
            <Stat label="Topics" value={data.counts.topics.toLocaleString()} />
            <Stat label="Priority" value={data.counts.priorityResults.toLocaleString()} />
            <Stat label="Sentiment" value={data.counts.sentimentResults.toLocaleString()} />
            <Stat label="Extractions" value={data.counts.extractions.toLocaleString()} />
            <Stat label="Insights" value={data.counts.insights.toLocaleString()} />
            <Stat
              label="New 24h"
              value={data.counts.posts24h.toLocaleString()}
              tone={data.counts.posts24h ? colors.blue : undefined}
              hint="posts ingested"
            />
          </div>
        </Bezel>
      </section>
    </div>
  )
}

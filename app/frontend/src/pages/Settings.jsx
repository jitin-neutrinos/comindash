import { useEffect, useMemo, useState } from 'react'
import FrameCard from '../components/FrameCard'
import { colors } from '../theme'
import MetricInfo from '../components/MetricInfo'
import {
  getOpsConfig,
  getOpsOverview,
  saveOpsConfig,
  triggerMaintenance,
  relTime,
  useApi,
} from '../api'

const pill = (state) => {
  const s = String(state || '').toLowerCase()
  if (s === 'ok' || s === 'idle') return 'bg-blue-50 text-blue-700 border-blue-200'
  if (s === 'warn') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (s === 'down' || s === 'critical') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

const stateLabel = (state) => {
  const s = String(state || '').toLowerCase()
  if (s === 'idle') return 'idle'
  if (s === 'warn') return 'warning'
  if (s === 'critical') return 'critical'
  return s || 'unknown'
}

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-line last:border-b-0">
      <div className="min-w-0">
        <div className="text-body font-medium">{label}</div>
        {hint && <div className="text-sm text-muted">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform ${on ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}

function NumberField({ value, onChange, min, max, step = 1, suffix, ariaLabel }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
    else setDraft(String(value))
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        aria-label={ariaLabel}
        className="w-28 rounded-lg border border-line bg-surface px-3 py-1.5 text-body focus:border-blue-500 focus:outline-none"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {suffix && <span className="text-sm text-muted">{suffix}</span>}
    </div>
  )
}

/**
 * Settings = runtime operations console. GPU economy (sidecar idle unload),
 * data retention, alerting, storage + queue health — all persisted through
 * /api/admin/ops/* so changes apply without a redeploy.
 */
export default function Settings() {
  const { data: overview, loading, error } = useApi(getOpsOverview, { intervalMs: 30000 })
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busyMaintenance, setBusyMaintenance] = useState(false)

  useEffect(() => {
    getOpsConfig()
      .then((c) => setCfg({ ...c, _orig: c }))
      .catch(() => setCfg(null))
  }, [])

  const dirty = useMemo(() => {
    if (!cfg?._orig) return null
    const changed = Object.keys(cfg._orig).filter(
      (k) => JSON.stringify(cfg[k]) !== JSON.stringify(cfg._orig[k]),
    )
    return changed.length ? changed : null
  }, [cfg])

  const set = (k, v) => setCfg((c) => (c ? { ...c, [k]: v } : c))

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    setMsg(null)
    try {
      const patch = Object.fromEntries(dirty.map((k) => [k, cfg[k]]))
      const saved = await saveOpsConfig(patch)
      setCfg({ ...saved, _orig: saved })
      setMsg({ kind: 'ok', text: 'Saved. GPU + retention changes apply on the next cycle (no restart).' })
    } catch (e) {
      setMsg({ kind: 'err', text: e?.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const runMaintenance = async () => {
    setBusyMaintenance(true)
    setMsg(null)
    try {
      await triggerMaintenance()
      setMsg({ kind: 'ok', text: 'Maintenance queued — retention purge + storage check runs in seconds.' })
    } catch (e) {
      setMsg({ kind: 'err', text: e?.message || 'Failed to queue' })
    } finally {
      setBusyMaintenance(false)
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-h2 font-semibold tracking-tight">Settings</h1>
          <MetricInfo metricKey="settingsPage" />
        </div>
        <p className="mt-1 font-light text-muted">
          Running the system, not studying it: how much power the AI engine uses, how long data is
          kept, and where alerts land.
        </p>
      </header>

      {/* live health strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FrameCard lift={false} className="!py-4">
          <div className="text-sm text-muted">Worker</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-medium capitalize ${pill(overview?.queue?.workerState)}`}>
              {stateLabel(overview?.queue?.workerState)}
            </span>
            {overview?.queue?.lastActivity && (
              <span className="text-sm text-muted">{relTime(overview.queue.lastActivity)}</span>
            )}
          </div>
        </FrameCard>
        <FrameCard lift={false} className="!py-4">
          <div className="text-sm text-muted">AI engine</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${pill(overview?.sidecar?.warm ? 'ok' : 'idle')}`}>
              {overview?.sidecar?.reachable ? (overview.sidecar.warm ? 'Ready' : 'Asleep') : 'Off'}
            </span>
            {overview?.sidecar?.reachable && overview.sidecar.vramMb !== null && (
              <span className="text-sm text-muted">{overview.sidecar.vramMb} MB memory in use</span>
            )}
          </div>
        </FrameCard>
        <FrameCard lift={false} className="!py-4">
          <div className="text-sm text-muted">Disk</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-sm font-medium ${pill(overview?.storage?.state)}`}>
              {stateLabel(overview?.storage?.state)}
            </span>
            <span className="text-sm text-muted">
              {overview ? `${overview.storage.usedPct}% full · ${overview.storage.freeGb} GB free` : '—'}
            </span>
          </div>
        </FrameCard>
        <FrameCard lift={false} className="!py-4">
          <div className="text-sm text-muted">To-do list</div>
          <div className="mt-1 text-body">
            {overview ? (
              <span>
                {overview.queue.pending} waiting · {overview.queue.running} running ·{' '}
                <span className={overview.queue.dead ? 'font-medium' : ''} style={overview.queue.dead ? { color: colors.salmon } : undefined}>{overview.queue.dead} gave up</span>
              </span>
            ) : ('—')}
          </div>
        </FrameCard>
      </div>

      {error && (
        <FrameCard lift={false}>
          <p className="text-body font-medium">Ops data unavailable: {String(error?.message || error)}</p>
        </FrameCard>
      )}
      {loading && !overview && (
        <FrameCard lift={false}>
          <p className="text-body text-muted">Loading operations data…</p>
        </FrameCard>
      )}

      {cfg && (
        <FrameCard title="AI engine power" infoKey="gpuEconomy">
          <Row
            label="Let the AI engine sleep when idle"
            hint={overview?.sidecar?.reachable
              ? `Engine is ${overview.sidecar.warm ? 'loaded and ready' : 'asleep'} · last used ${overview.sidecar.secondsSinceLastUse}s ago`
              : 'When idle for this long, the engine shuts down and frees its memory; the next analysis starts it again.'}
          >
            <Toggle on={Boolean(cfg.idle_unload_enabled)} onChange={(v) => set('idle_unload_enabled', v)} label="Unload GPU when idle" />
          </Row>
          <Row label="How long to wait before sleeping" hint="Idle time before the AI engine releases its memory.">
            <NumberField
              ariaLabel="Idle unload seconds"
              value={cfg.idle_unload_s}
              min={60}
              max={86400}
              step={30}
              suffix="seconds"
              onChange={(v) => set('idle_unload_s', v)}
            />
          </Row>
          <Row
            label="Analyses since last start"
            hint="Posts scored and posts scanned for names, by this engine run."
          >
            <span className="text-body tabular-nums">
              {overview?.sidecar?.requestsTotal ?? '—'}
              {overview?.sidecar?.rejectedSaturation ? ` (${overview.sidecar.rejectedSaturation} delayed because the engine was busy)` : ''}
            </span>
          </Row>
        </FrameCard>
      )}

      {cfg && (
        <FrameCard
          title="How long data is kept"
          infoKey="retentionPolicy"
          action={
            <button
              type="button"
              onClick={runMaintenance}
              disabled={busyMaintenance}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {busyMaintenance ? 'Queuing…' : 'Clean up now'}
            </button>
          }
        >
          <Row label="Completed jobs kept" hint="Housekeeping records of finished work. Deleted after this many days.">
            <NumberField ariaLabel="Job retention days" value={cfg.job_done_retention_days} min={1} max={365} suffix="days" onChange={(v) => set('job_done_retention_days', v)} />
          </Row>
          <Row label="Pipeline run history kept" hint="The record of each collection/analysis run, successes and failures alike.">
            <NumberField ariaLabel="Run retention days" value={cfg.run_retention_days} min={7} max={730} suffix="days" onChange={(v) => set('run_retention_days', v)} />
          </Row>
          <Row label="Audit trail kept" hint="Who changed what, kept for compliance.">
            <NumberField ariaLabel="Audit retention days" value={cfg.audit_retention_days} min={30} max={1095} suffix="days" onChange={(v) => set('audit_retention_days', v)} />
          </Row>
          <Row label="Analysed posts and findings" hint="This is the business data itself, so nothing is deleted automatically. The 18-month policy is a human decision, and it stays one.">
            <span className="text-sm text-muted">kept until you decide</span>
          </Row>
        </FrameCard>
      )}

      {cfg && (
        <FrameCard title="Alerts" infoKey="alertingPolicy">
          <Row label="Alert me when a job fails for good" hint="A push notification when a job has failed every retry.">
            <Toggle on={Boolean(cfg.alert_dead_jobs)} onChange={(v) => set('alert_dead_jobs', v)} label="Alert on dead jobs" />
          </Row>
          <Row label="Disk almost full alert" hint="A push notification when the disk passes this percentage full.">
            <NumberField ariaLabel="Storage alert percent" value={cfg.alert_storage_pct} min={50} max={99} suffix="%" onChange={(v) => set('alert_storage_pct', v)} />
          </Row>
          <Row label="Where alerts go" hint="Push notifications on your devices. Every failure is also recorded in Admin → System logs.">
            <span className="text-sm text-muted">device notifications</span>
          </Row>
        </FrameCard>
      )}

      {cfg && dirty && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3 shadow-lg">
          <span className="text-sm text-muted">
            {dirty.length} unsaved change{dirty.length > 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCfg({ ...cfg._orig, _orig: cfg._orig })}
              className="rounded-lg border border-line px-4 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Reset
            </button>
                       <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-emerald-600' : 'font-medium'}`}>{msg.text}</p>
      )}
    </div>
  )
}

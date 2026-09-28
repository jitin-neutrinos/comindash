// One expandable card per registered model: what it is, how well it scores,
// what it actually did to the corpus, and the git trail behind it.
//
// The card deliberately separates three claims that are easy to conflate:
//   1. DECLARED quality  — a holdout metric, true only for that eval set.
//   2. LIVE behaviour    — what it produced on the real corpus (no labels, so
//                          it proves coverage and shape, never correctness).
//   3. PROVENANCE        — training runs + git commits, including REJECTED
//                          runs, because knowing what was tried and refused is
//                          how a reviewer trusts what shipped.
import { useState } from 'react'
import { alpha, blueFill, colors, semantics } from '../../theme'
import { Bezel, Eyebrow, transition } from '../Surface'
import { formatDate } from '../../api'
import {
  ConfusionMatrix,
  DistributionRail,
  GitRail,
  MetricBar,
  ScoreDial,
  SpecGrid,
  STAGE_TONE,
  labelText,
  Stat,
  pct,
  scoreColor,
} from './ReviewKit'

const KIND_LABEL = {
  priority: 'Priority classification',
  sentiment: 'Sentiment classification',
  ner: 'Entity extraction',
  assistant: 'Insight generation',
}

// Lead with the product, not the engine block: these cards are fine-tuned Laya
// checkpoints (ModernBERT-large is the base encoder, listed under Provenance).
// Latency line is measured, not aspirational: 19-23 ms round-trip per post
// through the live sidecar (curl /classify, 2026-09-28).
const LAYA_TAGLINES = {
  priority:
    'Laya · System 1 decision engine. One forward pass — no generated text, no hallucinated confidence. Calibrated urgency in ~20 ms, measured live on this deployment.',
  sentiment:
    'Laya · System 1 decision engine. The same RL-trained reflexes, tuned for tone — one forward pass, honest probabilities, ~20 ms per decision, measured live.',
}
const isLaya = (m) => (m.displayName || '').toLowerCase().startsWith('laya')

const TABS = [
  { key: 'quality', label: 'Quality' },
  { key: 'live', label: 'Live behaviour' },
  { key: 'training', label: 'Training' },
  { key: 'provenance', label: 'Provenance' },
]

const OUTCOME_TONE = {
  deployed: colors.blue,
  rejected: colors.salmon,
  superseded: alpha(colors.black, 0.4),
  experimental: colors.iris,
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-pill px-3.5 py-1.5 text-small font-medium"
      style={{
        color: active ? colors.white : colors.black,
        backgroundColor: active ? blueFill : alpha(colors.black, 0.05),
        transition: transition('background-color, color', 260),
      }}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

const HEADLINE_CAPTION = {
  accuracy: 'accuracy',
  macro_f1: 'macro F1',
  mean_f1: 'mean F1',
}

/** Declared quality: the holdout scores, per class, plus the confusion matrix. */
function QualityPanel({ model }) {
  const ev = model.currentEvaluation
  if (!ev) {
    return (
      <div className="rounded-xl p-5" style={{ backgroundColor: alpha(colors.iris, 0.07) }}>
        <p className="text-small font-medium">No holdout evaluation recorded.</p>
        <p className="mt-1 text-small font-light leading-relaxed text-muted">
          {model.kind === 'assistant'
            ? 'This is a generative model behind an evidence gate, not a classifier — there is no labelled holdout to score it against. Its guarantee is structural: every insight it publishes cites post IDs that were verified to exist.'
            : 'Nothing here has been measured against gold labels, so no accuracy claim can be made for this model.'}
        </p>
      </div>
    )
  }

  const perClass = [...ev.perClass].sort((a, b) => (a.f1 ?? a.recall ?? 0) - (b.f1 ?? b.recall ?? 0))

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-[auto,1fr] sm:items-center">
        <ScoreDial
          value={model.headline.value}
          caption={HEADLINE_CAPTION[model.headline.kind] ?? 'score'}
          label={
            // "— holdout rows" reads as a missing measurement. When the eval
            // recorded no row count, say that plainly instead.
            ev.evalRows
              ? `${model.headline.label} · ${ev.evalRows.toLocaleString()} holdout rows`
              : `${model.headline.label} · row count not recorded`
          }
        />
        <div className="space-y-3">
          {perClass.map((c, i) => (
            <MetricBar
              key={c.label}
              label={c.label}
              value={c.f1 ?? c.recall}
              support={c.support}
              basis={c.f1 !== null && c.f1 !== undefined ? 'F1' : 'recall'}
              delay={i * 70}
            />
          ))}
        </div>
      </div>

      {model.weakestClass && (
        <div
          className="rounded-xl p-4"
          style={{ backgroundColor: alpha(scoreColor(model.weakestClass.score), 0.08) }}
        >
          <p className="text-small font-semibold">
            Weakest class:{' '}
            <span>{labelText(model.weakestClass.label)}</span> at{' '}
            {pct(model.weakestClass.score)} {model.weakestClass.basis}
          </p>
          <p className="mt-1 text-small font-light leading-relaxed text-muted">
            {model.weakestClass.support
              ? `Measured on ${model.weakestClass.support.toLocaleString()} holdout rows. `
              : 'Per-class row counts were not recorded for this evaluation. '}
            Headline accuracy hides this: a dominant class can carry the average while the class you
            actually care about is missed.
          </p>
        </div>
      )}

      {Object.keys(ev.confusion).length > 0 && (
        <div>
          <p className="mb-2 text-small font-semibold">Confusion matrix</p>
          <ConfusionMatrix confusion={ev.confusion} />
        </div>
      )}

      <SpecGrid
        columns={2}
        items={[
          { label: 'Eval set', value: ev.evalSetRef, mono: true },
          { label: 'Eval rows', value: ev.evalRows?.toLocaleString() },
          { label: 'Evaluated', value: ev.evaluatedAt ? formatDate(ev.evaluatedAt) : '' },
          { label: 'Macro F1', value: pct(ev.macroF1) },
          { label: 'Accuracy', value: pct(ev.accuracy) },
          { label: 'Evidence', value: ev.docRef, mono: true },
        ]}
      />
      {ev.notes && (
        <p className="text-small font-light leading-relaxed text-muted">{ev.notes}</p>
      )}
    </div>
  )
}

/** Live behaviour: what the model produced on the real corpus. */
function LivePanel({ model, windowDays }) {
  const ls = model.liveStats
  if (!ls) {
    return <p className="text-small font-light text-muted">No live output recorded.</p>
  }
  const tone =
    model.kind === 'priority'
      ? semantics.priority
      : model.kind === 'sentiment'
        ? semantics.sentiment
        : undefined

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Rows produced" value={(ls.rows ?? 0).toLocaleString()} />
        <Stat
          label="Posts covered"
          value={ls.postsScored !== null ? ls.postsScored.toLocaleString() : '—'}
          hint={ls.coverage !== null ? `${pct(ls.coverage, 1)} of corpus` : 'not applicable'}
        />
        <Stat
          label="Mean confidence"
          value={ls.meanConfidence !== null ? ls.meanConfidence.toFixed(3) : '—'}
          tone={ls.meanConfidence !== null ? scoreColor(ls.meanConfidence) : undefined}
        />
        <Stat
          label={`Last ${windowDays}d`}
          value={(ls.rowsInWindow ?? 0).toLocaleString()}
          hint="rows written"
        />
      </div>

      {ls.distribution.length > 0 && (
        <div>
          <p className="mb-2.5 text-small font-semibold">Label distribution on the live corpus</p>
          <DistributionRail rows={ls.distribution} tone={tone} />
        </div>
      )}

      {ls.confidenceBands && (
        <div>
          <p className="mb-2.5 text-small font-semibold">Confidence bands</p>
          <DistributionRail
            rows={Object.entries(ls.confidenceBands).map(([label, count]) => ({
              label,
              count: Number(count) || 0,
            }))}
          />
          <p className="mt-2 text-caption font-light leading-relaxed text-muted">
            Confidence is the model&apos;s own certainty, not correctness. A confident wrong answer
            sits in the top band exactly like a confident right one.
          </p>
        </div>
      )}

      {ls.note && (
        <div className="rounded-xl p-4" style={{ backgroundColor: alpha(colors.blue, 0.06) }}>
          <p className="text-small font-light leading-relaxed">{ls.note}</p>
        </div>
      )}
    </div>
  )
}

/** Training runs, including the ones that were rejected. */
function TrainingPanel({ model }) {
  if (!model.trainingRuns.length) {
    return (
      <p className="text-small font-light leading-relaxed text-muted">
        No training runs recorded — this model is used as shipped by its provider, with no local
        fine-tuning.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {model.trainingRuns.map((r) => {
        const tone = OUTCOME_TONE[r.outcome] ?? colors.iris
        return (
          <div
            key={r.id}
            className="rounded-xl p-4"
            style={{
              backgroundColor: alpha(tone, 0.055),
              boxShadow: `inset 0 0 0 1px ${alpha(tone, 0.16)}`,
            }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-pill px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: alpha(tone, 0.18), color: tone }}
                >
                  {r.outcome}
                </span>
                <p className="text-small font-semibold">{r.label}</p>
              </div>
              <p className="text-caption font-light text-muted">
                {r.startedAt ? formatDate(r.startedAt) : 'date not recorded'}
                {r.durationHours ? ` · ${r.durationHours}h` : ''}
              </p>
            </div>

            {r.outcomeReason && (
              <p className="mt-2 text-small font-light leading-relaxed">{r.outcomeReason}</p>
            )}

            <div className="mt-3">
              <SpecGrid
                columns={3}
                items={[
                  { label: 'Type', value: r.runType },
                  { label: 'Epochs', value: r.epochs },
                  { label: 'Final loss', value: r.finalLoss?.toFixed?.(4) },
                  { label: 'Hardware', value: r.hardware },
                  { label: 'Dataset', value: r.datasetRef, mono: true },
                  { label: 'Log', value: r.logPath, mono: true },
                ]}
              />
            </div>

            {Object.keys(r.dataset).length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-caption font-medium uppercase tracking-wider text-muted">
                  Training data
                </p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
                  {/* Flatten one level: a nested {rows, pos_share} object printed
                      as raw JSON is unreadable, and these are the numbers a
                      reviewer most wants (how much data, how balanced). */}
                  {Object.entries(r.dataset).flatMap(([k, v]) =>
                    v && typeof v === 'object' && !Array.isArray(v)
                      ? Object.entries(v).map(([k2, v2]) => [`${k} ${k2}`, v2])
                      : [[k, v]],
                  ).map(([k, v]) => (
                    <li key={k} className="text-caption font-light">
                      <span className="font-medium">{k.replace(/_/g, ' ')}</span>:{' '}
                      <span className="tabular-nums">
                        {typeof v === 'number' && v > 0 && v < 1
                          ? `${(v * 100).toFixed(1)}%`
                          : Array.isArray(v)
                            ? v.join(', ')
                            : String(v)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Object.keys(r.hyperparams).length > 0 && (
              <details className="mt-3">
                <summary
                  className="cursor-pointer text-caption font-medium"
                  style={{ color: colors.blue }}
                >
                  Hyperparameters
                </summary>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(r.hyperparams).map(([k, v]) => (
                    <li key={k} className="text-caption font-light">
                      <code className="rounded-sm bg-mist px-1 py-0.5">
                        {k}={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </code>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {r.gitCommit && (
              <p className="mt-3 text-caption font-light text-muted">
                Code at{' '}
                <code
                  className="rounded-sm px-1.5 py-0.5 font-semibold"
                  style={{ backgroundColor: alpha(colors.blue, 0.1), color: colors.blue }}
                >
                  {r.gitCommit.slice(0, 8)}
                </code>
                {r.gitSubject ? ` — ${r.gitSubject}` : ''}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Provenance: identity, serving path, git history. */
function ProvenancePanel({ model, repoHead }) {
  return (
    <div className="space-y-6">
      <SpecGrid
        columns={2}
        items={[
          { label: 'Base model', value: model.baseModel, mono: true },
          { label: 'Architecture', value: model.architecture },
          { label: 'Parameters', value: model.paramCount },
          { label: 'Provider', value: model.provider },
          { label: 'License', value: model.license },
          { label: 'Serving via', value: model.servingVia },
          { label: 'Checkpoint', value: model.checkpointPath, mono: true },
          { label: 'Training set', value: model.trainingSetRef, mono: true },
          { label: 'Trained', value: model.trainedAt ? formatDate(model.trainedAt) : '' },
          { label: 'Deployed', value: model.deployedAt ? formatDate(model.deployedAt) : '' },
        ]}
      />
      {isLaya(model) && (
        <p className="text-caption font-light leading-relaxed text-muted">
          Trained with the Laya framework (RLCD / GRPO over a bidirectional encoder) on our own
          community posts — the same decision-model family published at{' '}
          <a
            href="https://laya.convaiinnovations.com"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: colors.blue }}
          >
            laya.convaiinnovations.com
          </a>
          . ModernBERT-large is the engine block; Laya is the car.
        </p>
      )}

      {model.labels.length > 0 && (
        <div>
          <p className="mb-2 text-caption font-medium uppercase tracking-wider text-muted">
            Label vocabulary ({model.labels.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {model.labels.map((l) => (
              <code
                key={l}
                className="rounded-pill px-2.5 py-1 text-caption"
                style={{ backgroundColor: alpha(colors.blue, 0.08), color: colors.black }}
              >
                {l}
              </code>
            ))}
          </div>
        </div>
      )}

      {Object.keys(model.calibration).length > 0 && (
        <div>
          <p className="mb-2 text-caption font-medium uppercase tracking-wider text-muted">
            Calibration & thresholds
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {Object.entries(model.calibration).map(([k, v]) => (
              <li key={k} className="text-caption font-light">
                <span className="font-medium">{k.replace(/_/g, ' ')}</span>:{' '}
                <span className="tabular-nums">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2.5 text-small font-semibold">Version history (git)</p>
        <GitRail commits={model.gitHistory} paths={model.gitPaths} head={model.gitCommit} />
      </div>

      {model.provenanceUrl && (
        <a
          href={model.provenanceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-small font-medium"
          style={{ color: colors.blue }}
        >
          {isLaya(model) ? 'Base encoder card ↗' : 'Base model card ↗'}
        </a>
      )}
    </div>
  )
}

export default function ModelCard({ model, windowDays, repoHead }) {
  const [tab, setTab] = useState('quality')
  const tone = STAGE_TONE[model.stage] ?? colors.blue

  return (
    <Bezel accent={tone} radius={20} pad={5} data-anim="row">
      <div className="p-6">
        {/* --- identity ------------------------------------------------- */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow color={tone}>{KIND_LABEL[model.kind] ?? model.kind}</Eyebrow>
              <span
                className="rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: alpha(tone, 0.14), color: tone }}
              >
                {model.stage}
              </span>
              {!model.exercised && (
                <span
                  className="rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: alpha(colors.black, 0.07),
                    color: alpha(colors.black, 0.6),
                  }}
                >
                  no live output
                </span>
              )}
            </div>
            <h3 className="mt-2.5 text-h3 font-semibold leading-tight tracking-tight">
              {model.displayName}
            </h3>
            {isLaya(model) ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ backgroundColor: alpha(tone, 0.14), color: tone }}
                  >
                    Laya
                  </span>
                  <span
                    className="rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor: alpha(colors.black, 0.07),
                      color: alpha(colors.black, 0.6),
                    }}
                  >
                    Fine-tuned in-house
                  </span>
                  <span
                    className="rounded-pill px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor: alpha(colors.blue, 0.1),
                      color: colors.blue,
                    }}
                  >
                    ~20 ms / decision
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-small font-light leading-relaxed text-muted">
                  {LAYA_TAGLINES[model.kind] ?? model.task}
                </p>
              </>
            ) : (
              <p className="mt-1 max-w-2xl text-small font-light leading-relaxed text-muted">
                {model.task}
              </p>
            )}
          </div>

          <div className="text-right">
            <p
              className="text-h2 font-semibold leading-none tabular-nums tracking-tight"
              style={{ color: scoreColor(model.headline.value) }}
            >
              {pct(model.headline.value)}
            </p>
            <p className="mt-1 text-caption font-light text-muted">{model.headline.label}</p>
            {model.gitShort && (
              <code
                className="mt-2 inline-block rounded-sm px-1.5 py-0.5 text-caption font-semibold"
                style={{ backgroundColor: alpha(colors.blue, 0.1), color: colors.blue }}
                title={model.gitSubject}
              >
                {model.gitShort}
              </code>
            )}
          </div>
        </div>

        {model.notes && (
          <p className="mt-4 max-w-3xl text-small font-light leading-relaxed">{model.notes}</p>
        )}

        {/* --- run summary ---------------------------------------------- */}
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
          <Stat label="Training runs" value={model.runCounts.total} />
          <Stat label="Deployed" value={model.runCounts.deployed} tone={colors.blue} />
          <Stat
            label="Rejected"
            value={model.runCounts.rejected}
            tone={model.runCounts.rejected ? colors.salmon : undefined}
            hint={model.runCounts.rejected ? 'tried, measured, refused' : undefined}
          />
          <Stat label="Evaluations" value={model.evaluations.length} />
        </div>

        {/* --- tabs ------------------------------------------------------ */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </TabButton>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'quality' && <QualityPanel model={model} />}
          {tab === 'live' && <LivePanel model={model} windowDays={windowDays} />}
          {tab === 'training' && <TrainingPanel model={model} />}
          {tab === 'provenance' && <ProvenancePanel model={model} repoHead={repoHead} />}
        </div>
      </div>
    </Bezel>
  )
}

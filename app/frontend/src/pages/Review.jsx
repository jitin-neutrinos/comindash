// /admin → Review tab: the AI system of record.
//
// What this page is for: a reader should leave knowing exactly which models are
// serving, how well each was measured (and on what), what each one actually did
// to the corpus, and which commit produced it. Claims that were never measured
// must say so rather than defaulting to a plausible-looking number.
import { useMemo } from 'react'
import { getReview, formatDate, relTime, useApi } from '../api'
import { alpha, colors } from '../theme'
import { usePageChoreo } from '../motion'
import { Bezel, Eyebrow, SectionHead } from '../components/Surface'
import { MetricSkeleton, RowsSkeleton } from '../components/Skeletons'
import ModelCard from '../components/review/ModelCard'
import { ScoreDial, Stat, pct, scoreColor } from '../components/review/ReviewKit'

/** Models sort by how much a reviewer needs to look at them: live first, then
 *  by weakest headline score. A strong model buried under a weak one wastes the
 *  reader's attention. */
const order = (a, b) => {
  const stageRank = (m) => (m.stage === 'live' ? 0 : m.stage === 'candidate' ? 1 : 2)
  const d = stageRank(a) - stageRank(b)
  if (d !== 0) return d
  return (a.headline.value ?? 2) - (b.headline.value ?? 2)
}

export default function Review({ embedded = false }) {
  const { data, loading, error } = useApi(() => getReview({ days: 30 }), { intervalMs: 120000 })
  // Embedded in the Admin tab shell, the parent already runs the entrance
  // timeline. Running a second one here re-hides elements the parent just
  // faded in, so the tab would flash blank on every switch.
  const ownRoot = usePageChoreo([loading, embedded])
  const root = embedded ? undefined : ownRoot

  const models = useMemo(() => (data ? [...data.models].sort(order) : []), [data])

  const weakest = useMemo(() => {
    const scored = models.filter((m) => m.weakestClass?.score !== null && m.weakestClass)
    if (!scored.length) return null
    return scored.reduce((lo, m) => (m.weakestClass.score < lo.weakestClass.score ? m : lo))
  }, [models])

  if (error) {
    return (
      <div className="p-6">
        <Bezel accent={colors.salmon}>
          <div className="p-6">
            <p className="text-small font-semibold">Could not load the model registry.</p>
            <p className="mt-1 text-small font-light text-muted">{error.message}</p>
          </div>
        </Bezel>
      </div>
    )
  }

  return (
    <div ref={root} className="space-y-8">
      {/* --- header ------------------------------------------------------ */}
      {/* Embedded under Admin, the page already has an <h1>; a second one
          breaks the heading outline for screen readers. */}
      {!embedded && (
        <header data-anim="header">
          <Eyebrow>AI system of record</Eyebrow>
          <h1 className="mt-3 text-h1 font-semibold leading-tight tracking-tight">Model review</h1>
          <p className="mt-2 max-w-3xl text-body font-light leading-relaxed text-muted">
            Every model serving this dashboard, what it was measured at and on which evidence, what
            it produced on the live corpus, and the commit that built it. Registered from the repo
            by{' '}
            <code className="rounded-sm bg-mist px-1.5 py-0.5 text-small">
              ml/scripts/register_model.py
            </code>
            , so this page moves when the models do.
          </p>
        </header>
      )}

      {/* --- summary ----------------------------------------------------- */}
      {loading && !data ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <MetricSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[auto,1fr]" data-anim="kpi">
          <Bezel accent={colors.blue} radius={20} pad={5}>
            <div className="flex h-full items-center justify-center p-6">
              <ScoreDial
                value={weakest?.weakestClass?.score ?? null}
                caption="weakest class"
                size={148}
                label={
                  weakest
                    ? `${weakest.displayName} · ${weakest.weakestClass.label} at ${pct(
                        weakest.weakestClass.score,
                      )} ${weakest.weakestClass.basis}`
                    : 'No per-class scores recorded'
                }
              />
            </div>
          </Bezel>

          <Bezel accent={colors.blue} radius={20} pad={5}>
            <div className="grid h-full grid-cols-2 gap-6 p-6 sm:grid-cols-3">
              <Stat
                label="Registered versions"
                value={data.summary.totalVersions}
                hint={`${data.summary.live} serving live`}
              />
              <Stat
                label="Training runs"
                value={data.summary.trainingRuns}
                hint={
                  data.summary.rejectedRuns
                    ? `${data.summary.rejectedRuns} rejected after measurement`
                    : 'all deployed'
                }
              />
              <Stat label="Evaluations" value={data.summary.evaluations} hint="holdout scorings" />
              <Stat
                label="Corpus"
                value={data.totalPosts.toLocaleString()}
                hint="posts available to score"
              />
              <Stat label="Window" value={`${data.windowDays}d`} hint="live-behaviour window" />
              <Stat
                label="Generated"
                value={data.generatedAt ? relTime(data.generatedAt) : '—'}
                hint="auto-refreshes every 2m"
              />
            </div>
          </Bezel>
        </div>
      )}

      {/* --- honest framing ---------------------------------------------- */}
      <Bezel accent={colors.iris} radius={18} pad={4} data-anim="row">
        <div className="p-5">
          <p className="text-small font-semibold">How to read these numbers</p>
          <ul className="mt-2 space-y-1.5 text-small font-light leading-relaxed text-muted">
            <li>
              <span className="font-medium text-black">Declared quality</span> is measured on a
              held-out labelled set. It is true for that set — not a guarantee on new data.
            </li>
            <li>
              <span className="font-medium text-black">Live behaviour</span> has no gold labels, so
              it shows coverage and label shape, never correctness. Confidence is the model&apos;s
              own certainty; a confident wrong answer looks exactly like a confident right one.
            </li>
            <li>
              <span className="font-medium text-black">Rejected runs are shown on purpose.</span>{' '}
              Knowing what was tried and measured as worse is what makes the shipped version
              trustworthy.
            </li>
            <li>
              Headline accuracy can hide a weak class. Each card names its weakest class and the
              number of rows that class was scored on.
            </li>
          </ul>
        </div>
      </Bezel>

      {/* --- model cards -------------------------------------------------- */}
      <section>
        <SectionHead
          eyebrow="Registry"
          title="Models in this system"
          action={
            data && (
              <p className="text-caption font-light text-muted">
                Live-behaviour window: last {data.windowDays} days
              </p>
            )
          }
        />
        {loading && !data ? (
          <RowsSkeleton rows={4} />
        ) : (
          <div className="space-y-5">
            {models.map((m) => (
              <ModelCard key={m.id} model={m} windowDays={data.windowDays} />
            ))}
          </div>
        )}
      </section>

      {data && (
        <p className="pb-2 text-caption font-light text-muted">
          Registry last written {data.generatedAt ? formatDate(data.generatedAt) : '—'}. To update
          after a retrain, edit the REGISTRY block in{' '}
          <code className="rounded-sm bg-mist px-1.5 py-0.5">ml/scripts/register_model.py</code> and
          run it — it re-reads git and rewrites this page&apos;s data.
        </p>
      )}
    </div>
  )
}

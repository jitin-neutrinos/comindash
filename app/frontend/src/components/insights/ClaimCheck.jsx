// What the insight claims, and whether the corpus backs it up.
//
// The old section printed the assistant's raw relationship rows:
//
//     alpha  has_production_risk_in  jBPM async job replay        0.9
//
// Three problems. `has_production_risk_in` is a model token, not English. The
// 0.9 is the model's self-assessment presented in the visual language of a
// measurement. And there was nothing to click, so a reader who doubted it had
// no way to check.
//
// This component shows the claim as a sentence, the verdict as a measurement,
// and the posts underneath it. The assistant's own confidence is still here,
// but demoted to what it is: an opinion, shown next to the evidence that
// either backs it or does not.

import { useLayoutEffect, useRef, useState } from 'react'
import { colors } from '../../theme'
import { gsap, canAnimateEntrance } from '../../motion'

const DISCOURSE = 'https://community.neutrinos.com'

// Each verdict states what the number means, in the reader's terms.
const VERDICTS = {
  supported: {
    word: 'Backed by the data',
    color: colors.mint,
    blurb: 'These appear together far more than chance would produce.',
  },
  thin: {
    word: 'Thin support',
    color: colors.blue,
    blurb: 'They do overlap, but too little to call it a pattern yet.',
  },
  unsupported: {
    word: 'Not backed by the data',
    color: colors.salmon,
    blurb: 'Both exist in the corpus, but never in the same post.',
  },
  unverifiable: {
    word: "Can't be checked",
    color: colors.iris,
    blurb: 'One side of this claim does not match anything in the corpus.',
  },
}

const verdictOf = (v) => VERDICTS[v] ?? VERDICTS.unverifiable

const KIND_LABEL = {
  product: 'product',
  person: 'person',
  topic: 'topic',
  concept: 'concept',
}

/** How much more often than chance, in words a reader can act on. */
const liftPhrase = (lift) => {
  if (lift === null) return null
  if (lift >= 2) return `${lift}x more often than chance`
  if (lift >= 1.3) return `${lift}x more often than chance`
  if (lift > 0) return `less often than chance would predict`
  return 'never together'
}

const Endpoint = ({ ep }) => (
  <span className="inline-flex min-w-0 items-baseline gap-1.5">
    <span className="min-w-0 truncate font-semibold" title={ep.raw || ep.label}>
      {ep.label}
    </span>
    <span className="shrink-0 text-caption text-muted">
      {ep.resolved ? (
        <>
          {KIND_LABEL[ep.kind] ?? ep.kind} · {ep.posts.toLocaleString()} posts
        </>
      ) : (
        'no match in corpus'
      )}
    </span>
  </span>
)

/**
 * The measurement, drawn as two bars against one scale.
 *
 * Expected-vs-observed is the whole argument in one picture: a claim is only
 * interesting when the observed bar clears the chance bar. Numbers alone make
 * the reader do that comparison in their head.
 */
const SupportBar = ({ observed, expected, color }) => {
  const fillRef = useRef(null)
  const max = Math.max(observed, expected, 1)
  const obsPct = Math.max((observed / max) * 100, observed > 0 ? 2 : 0)
  const expPct = Math.max((expected / max) * 100, expected > 0 ? 2 : 0)

  useLayoutEffect(() => {
    const el = fillRef.current
    if (!el) return
    // Reduced motion, or a hidden tab where rAF is frozen: set the final
    // width outright. The element's inline style starts at width 0, so a
    // tween that never runs would leave the bar permanently empty.
    if (!canAnimateEntrance()) {
      el.style.width = `${obsPct}%`
      return
    }
    const tw = gsap.fromTo(
      el,
      { width: '0%' },
      { width: `${obsPct}%`, duration: 0.7, ease: 'power2.out', delay: 0.1 },
    )
    // progress(1) before kill so an interrupted bar lands at its real width.
    return () => tw.progress(1).kill()
  }, [obsPct])

  return (
    <div className="space-y-1.5">
      <div className="relative h-2.5 w-full rounded-pill bg-mist">
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 rounded-pill"
          style={{ width: 0, background: color }}
        />
        {/* Chance marker: the bar has to beat this line to mean anything. */}
        {expected > 0 ? (
          <div
            className="absolute inset-y-[-3px] w-px bg-black/60"
            style={{ left: `${Math.min(expPct, 100)}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-2 text-caption text-muted">
        <span className="tabular-nums">
          <span className="font-semibold text-ink">{observed.toLocaleString()}</span>{' '}
          {observed === 1 ? 'post mentions' : 'posts mention'} both
        </span>
        <span className="tabular-nums">chance: {expected.toLocaleString()}</span>
      </div>
    </div>
  )
}

const Evidence = ({ items }) => (
  <ul className="mt-3 space-y-2 border-t border-line pt-3">
    {items.map((p) => (
      <li key={p.postId} className="min-w-0">
        <a
          className="group block min-w-0 rounded-lg px-2 py-1.5 transition-colors hover:bg-mist/60"
          href={`${DISCOURSE}/t/${p.slug || 'topic'}/${p.topicId}/${p.discoursePostId}`}
          target="_blank"
          rel="noreferrer"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-small font-medium group-hover:underline">
              {p.topic || 'Untitled topic'}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-muted">
              {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-caption text-muted">{p.excerpt}</p>
        </a>
      </li>
    ))}
  </ul>
)

const ClaimCard = ({ c }) => {
  const [open, setOpen] = useState(false)
  const v = verdictOf(c.verdict)
  const lift = liftPhrase(c.lift)
  const hasEvidence = c.evidence.length > 0

  return (
    <li className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      {/* The claim, as a sentence. */}
      <p className="min-w-0 text-body leading-relaxed">
        <Endpoint ep={c.subject} />{' '}
        <span className="text-muted">{c.relation}</span>{' '}
        <Endpoint ep={c.object} />
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption font-semibold"
          style={{ background: `${v.color}22`, color: colors.black }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: v.color }}
            aria-hidden="true"
          />
          {v.word}
        </span>
        {lift ? (
          <span className="text-caption tabular-nums text-muted">{lift}</span>
        ) : null}
      </div>

      <p className="mt-2 text-caption text-muted">{v.blurb}</p>

      <div className="mt-3">
        <SupportBar
          observed={c.coOccurringPosts}
          expected={c.expectedByChance}
          color={v.color}
        />
      </div>

      {/* How the phrase was matched — without this, an unresolved endpoint
          looks like a data error rather than a wording mismatch. */}
      {c.object.matchedOn || c.subject.matchedOn ? (
        <p className="mt-2 text-caption text-muted">
          Matched on {[c.subject.matchedOn, c.object.matchedOn].filter(Boolean).join(', ')}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-caption text-muted">
          Analyst&rsquo;s own confidence:{' '}
          <span className="tabular-nums">{Math.round(c.assertedConfidence * 100)}%</span>
          <span className="ml-1 opacity-70">(an opinion, not a measurement)</span>
        </span>
        {hasEvidence ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-pill border border-line px-3 py-1 text-caption font-medium transition-colors hover:bg-mist"
            aria-expanded={open}
          >
            {open ? 'Hide posts' : `Show ${c.evidence.length} ${c.evidence.length === 1 ? 'post' : 'posts'}`}
          </button>
        ) : null}
      </div>

      {open && hasEvidence ? <Evidence items={c.evidence} /> : null}
    </li>
  )
}

/** Verdict tally — the reader's first question is "how much of this holds up?" */
const Summary = ({ summary }) => {
  const parts = [
    ['supported', summary.supported],
    ['thin', summary.thin],
    ['unsupported', summary.unsupported],
    ['unverifiable', summary.unverifiable],
  ].filter(([, n]) => n > 0)

  if (!parts.length) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {parts.map(([key, n]) => {
        const v = verdictOf(key)
        return (
          <span key={key} className="inline-flex items-center gap-1.5 text-caption">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: v.color }}
              aria-hidden="true"
            />
            <span className="tabular-nums font-semibold">{n}</span>
            <span className="text-muted">{v.word.toLowerCase()}</span>
          </span>
        )
      })}
    </div>
  )
}

export default function ClaimCheck({ data, loading, error }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-4">
            <div className="shimmer h-3 w-3/4 rounded-sm" />
            <div className="shimmer mt-3 h-2.5 w-full rounded-pill" />
            <div className="shimmer mt-3 h-2 w-1/3 rounded-sm" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-small text-muted">
        Could not check these claims against the corpus ({String(error.message || error)}).
      </p>
    )
  }

  const claims = data?.claims ?? []
  if (!claims.length) {
    return (
      <p className="text-small text-muted">
        This insight asserts no relationships, so there is nothing to verify.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <Summary summary={data.summary} />
      <ul className="space-y-3">
        {claims.map((c) => (
          <ClaimCard key={c.id} c={c} />
        ))}
      </ul>
      <p className="text-caption text-muted">
        Checked against {data.corpusPosts.toLocaleString()} posts at load time. &ldquo;Chance&rdquo;
        is how often two things this common would land in the same post at random.
      </p>
    </div>
  )
}

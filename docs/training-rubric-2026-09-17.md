# Training Rubric — Priority "high" & Sentiment "pos" (2026-09-17)

Purpose: single definition of what counts as `high` (priority) and `pos` (sentiment),
used to scrub the training CSVs and to label new rows (Review Hub + future exports).
Built by reading all 93 `high` rows and all 199 `pos` rows in the current exports.

## Priority — what counts as **high**

> **high = something that, unread, breaks someone's work right now, breaks production/sandbox
> for everyone, or carries security/legal exposure. The reader must act or lose something.**

Four high families (all three model symptoms traced to these being mixed with everything else):

1. **Blocked work** — a person is stuck and says so: "blocker", "cannot access/login", "unable to
   move forward", "stopped and are not restarting". Named-victim posts (@Sam, please help).
2. **Security exposure** — vulnerability reports, CVE notes, certificate/HSTS failures, container
   image security scans, security advisories.
3. **Critical ops advisories** — "Action Required", "critical issue/demo", production incidents,
   data-corruption risks, stop-the-presses notices ("pause deployments immediately").
4. **Releases with teeth** — release notes that contain at least one of: breaking changes,
   security fixes, mandatory migrations/upgrades (mTLS, chart contract changes), patched CVEs,
   or "Action Required". *Release notes without any of those = medium (awareness), not high.*

Explicitly **not** high (this was 45% of the old high set — the dilution that taught the model
"high means announcements"):

- **Marketing / case studies** (17 rows demoted to `low`): insurer success stories, BCG
  spotlights, market projections, "see how X transformed Y". No reader action, no victim.
- **Guides & reference material** (15 rows demoted to `medium`): walkthroughs, debugging guides,
  how-tos, tips ("avoid sequential calls"), tool announcements.
- **POC showcases** (demoted to `medium`): "excited to share a POC I built" — celebrating work,
  not blocked by it. A POC *that is blocked* stays high (family 1).
- **Simple questions / discussions** (demoted to `low`): "please confirm if X is acceptable".

Tie-breaker sentence: *if nobody needs to do anything after reading it, it is not high.*

## Sentiment — what counts as **pos**

> **pos = the writer expresses satisfaction, gratitude, or relief about something that happened.**

The real pos class is one big family plus a small tail:

1. **Thanks / works-now confirmations** (108 of 199 — 54%): "thanks, now it's working",
   "got the access", "able to login now", "Fixed. Please try now." Short, cue-dense.
   This concentration is why the model overfit to praise phrases and still scored 44% —
   at 9.6% prevalence it guess-ducked the whole class.
2. **Genuine praise**: "awesome guide", "very helpful", appreciation of an answer.
3. **Positive progress updates**: "I've successfully logged in", "I have received it".

Not pos, even though they mention working/access (3 rows fixed in the scrub):

- Policy statements that merely contain the word access: "Trinity access cannot be provided" → `neu`.
- Fault reports: "Workbench is not working, I see only a blank page" → `neg`.
- "The password you shared is not working for me" → `neg` (frustration, not relief).

Negative cues beat positive words: "not working" inside a pos-labeled row is a mislabel unless
the sentence resolves it ("was stuck, now it works").

## What changed in the data (programmatic scrub, every change logged)

| | priority | sentiment |
|---|---|---|
| Relabels | 40 (17 marketing→low, 15 guide→medium, 2 toothless release→medium, 1 showcase→medium, 1 question→low, 4 story→low) | 3 (2→neu, 1→neg) |
| Exact duplicates dropped | 64 | 64 |
| Ambiguous rows KEPT as high, flagged for your review | 5 (see relabel_review_priority.csv) | 0 |
| Real rows after scrub | 2,001 | 2,001 |
| Seed-guided variants added (real high 58, real pos 194) | +207 | +229 |
| **Final rebalanced file** | **2,208 rows — high 265 (12.0%)** | **2,230 rows — pos 423 (19.0%)** |

Variant rules applied (per the evidence in model-metrics-research-2026-09-17.md):
seeded on real minority rows only; greeting jitter, truncation, product/@mention/version swap,
sign-off append; label-cue guard (a variant that loses its cue phrase is dropped, not forced);
zero synthetic rows in any ground-truth/batch-test file; deterministic (seed 42, reproducible
via `app/scripts/build_rebalanced_training.py`).

## How to use this going forward

- **Retrain** → Add New Data → upload `training_priority_rebalanced.csv` /
  `training_sentiment_rebalanced.csv` (label column: `label`). Same models, new versions.
- **Batch-test** with `app/scripts/make_batchtest_real.py` output (real posts only, zero synthetic).
- **Review Hub**: when confirming/correcting, apply the tie-breaker sentence above.
- Realistic expectations: 12% high share is inside the evidenced 15–25% rebalance band's lower
  edge (we will not manufacture more fake highs than real ones — 3.4 variants per real row is
  already the aggressive end). Expect high recall to climb off 0 into a usable band; the ≥90% F1
  gate on high is still ambitious and should be re-judged after this retrain's batch test.

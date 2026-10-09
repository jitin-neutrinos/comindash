# Laya priority/sentiment: product-context fine-tune experiment (2026-09-28)

> **Historical record.** Paths below to training data (`app/exports/`, `ml/data_split/`) and one-off training scripts are not in this repo — datasets are regenerated from the database, and one-off scripts were removed during repo sanitization. Kept for provenance.

## Question
Does injecting NER-derived product identity (e.g. "trinity", "ai_hub") into the
Laya priority/sentiment classifier's input improve its judgment, following the
domain-knowledge-injection pattern from the ABSA/knowledge-graph literature?

## What was built
- `ml/laya/product_context.py` — shared tagging helper. Runs the live forum-v3
  GLiNER checkpoint over a batch of texts and prepends `[product: X] ` when a
  trained product label is detected above threshold 0.4. Used identically by
  training, eval, and (if ever wired in) live inference, so there's no
  train/serve skew.
- `ml/laya/build_training_data.py` — tags priority training rows only (see
  "why not sentiment" below); untouched sentiment path.
- `ml/scripts/eval_laya_holdout.py` — `LAYA_TAG_INPUT=1` env var applies the
  same tagging to the priority holdout set before scoring, so eval matches
  what a tagged checkpoint actually trained on. Sentiment holdout stays
  untagged to match training.
- `ml/laya/train_single_gpu.py` — output dir now takes `LAYA_OUTPUT_NAME` env
  var (was hardcoded `insights-v1`) so experiments don't overwrite the live
  checkpoint while comparing.

## Result: mixed, not a clean win — not deployed

Same 363-row priority / 360-row sentiment holdout, same eval script, three
checkpoints:

| Checkpoint | Priority acc | High recall | Sentiment acc |
|---|---|---|---|
| v1 (baseline, live) | 93.4% | 53% (9/17) | 92.8% |
| v3 (tagged priority+sentiment, +19 mined blocker rows) | 94.2% | 59% (10/17) | 91.1% |
| v4 (tagged priority only, same +19 rows) | 93.1% | 59% (10/17) | 90.8% |

**Real, reproducible signal:** high-priority recall improved 53%→59% in both
independent retrains. Row-level diff against v1 (not just the aggregate
number) confirms it: a Trinity release-note post with "Breaking Changes"
correctly flipped medium→high in both v3 and v4, and zero regressions
appeared on any of the 17 gold-high holdout rows either time.

**Not clean:** the hypothesis "sentiment regressed because we tagged sentiment
rows too" was tested directly — v4 removed sentiment tagging entirely, and
sentiment got *worse*, not better (91.1%→90.8%), while priority accuracy also
dropped (94.2%→93.1%) despite identical priority-side changes. That rules out
the tagging-sentiment-rows theory. Most likely explanation: this is a small
dataset (1807/1871 rows), 4 epochs, RL-style reward training that plateaus
early (reward converges to ~0.862 by epoch 2) — normal run-to-run variance on
a holdout this size (17 high-priority rows, 35 positive-sentiment rows) can
swing a couple of percentage points either way without meaning anything.

## Decision
Not deploying v3 or v4. Neither beats the live v1 baseline on both metrics
simultaneously — the high-recall gain is real but the evidence isn't strong
enough, and the cost (sentiment regression, noisy aggregate) isn't worth
replacing a working production model over 1-2 row swings on a tiny holdout.
Sidecar stays on `insights-v1`.

## What would make this conclusive
- More real training data for the release-note/blocker pattern specifically
  (dozens of examples, not the 19 mined this round).
- Multiple training seeds per configuration, averaged — one run each is not
  enough to separate signal from noise at this dataset size.
- A larger or stratified holdout so a handful of flipped predictions doesn't
  swing the headline number by several points.
- The tooling above (`product_context.py`, tag-aware build/eval scripts) is
  reusable for that next attempt without rebuilding anything.

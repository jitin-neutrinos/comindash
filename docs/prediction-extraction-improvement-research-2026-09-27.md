# Prediction & Extraction Improvement Research (2026-09-27)

Ground truth for the numbers below: `docs/model-audit-2026-09-27.md`. Current
setup (read from `ml/laya/train_single_gpu.py`, `ml/pipeline/inference_server.py`,
`ml/gliner/`): Laya is a GRPO-style proper-scoring-rule fine-tune with
post-training per-question-type temperature calibration; a first pass at
inverse-frequency class weighting ("Fix 2") already exists in
`train_single_gpu.py` but is applied as one global scalar (`r = r * 1.15`) on
the reward, not a per-row weight keyed to each item's actual class — the code
comment itself flags this as a simplified stand-in for a proper per-row
version. GLiNER has already been fine-tuned once on `training_ner_v2.csv`
(checkpoint at `ml/gliner/checkpoints/forum-v2`, `ml/gliner_finetune.log`:
macro F1 89.6%, PERSON F1 97%, EMAIL F1 100%, PRODUCT F1 72%) and the
EMAIL regex backstop + @-mention filter described in the audit is already
wired into `inference_server.py::extract()`. This report treats those as
existing partial mitigations and researches what to do next.

No files under `app/` or `ml/` were modified to produce this report.

---

## 1. Priority classifier — HIGH recall 50% (10/20 holdout)

Two separate problems per the audit: ~4 of 10 misses are debatable gold
labels (rubric disagreement), ~6 are genuine misses on short, terse support
posts.

**Options:**

1. **Per-row focal loss or class-weighted loss on the RL reward, replacing
   the current global scalar.** Focal loss down-weights easy/majority
   examples and up-weights hard/minority ones during training, which is
   exactly the low/high imbalance here (67.7% low vs 10.8% high in the
   rebalanced train set is already a mitigation, but the reward-level fix is
   currently non-functional per-class). [1] is the original focal loss
   formulation (object detection, but the mechanism transfers directly to
   classification heads); [4] is a loss purpose-built for imbalanced NLP
   tasks (token/sequence tagging and classification) and is a closer fit
   than adapting a CV loss. Cheapest version: fix the existing per-item
   `CLASS_WEIGHTS` dict in `train_single_gpu.py` so the weight is actually
   looked up per-row instead of applied as one batch-level scalar — this is
   a bug fix in already-written intent, not new design.
2. **Threshold/temperature recalibration per class instead of retraining.**
   The model already outputs calibrated temperatures
   (`rl_agent_config.json`: `[5.43, 1.2, 1.2]`); a decision threshold moved
   toward HIGH (i.e., lower the bar for calling HIGH, accepting more
   false positives from medium) is a config-only lever that trades
   precision for recall without touching weights. [3] is the canonical
   walkthrough of threshold-moving for imbalanced classification;
   [7] is a specific tool for probability-threshold adjustment under
   imbalance, applicable to Laya's `answer_confidence` output.
3. **Targeted data augmentation for short support posts.** The 6 genuine
   misses are short, terse posts ("cannot access Console, please help").
   EDA-style perturbations (synonym replacement, random insertion, random
   swap, random deletion) are shown to measurably help on exactly this kind
   of short-text, small-data classification task [5]; back-translation is a
   heavier but frequently used alternative when paraphrase diversity matters
   more than volume [6]. Either requires new/augmented labeled data, not
   just config.
4. **Rubric alignment pass on the ~4 debatable HIGH labels.** Not a
   modeling technique — a data-quality fix. The audit already identifies the
   specific debatable rows (IDP market-size report, security-transparency
   post, "sequential API calls" advice). [8] is recent work on formally
   separating signal from noise in annotator disagreement, which is the
   right frame for deciding which of the 4 are genuinely mislabeled vs.
   legitimately ambiguous before spending effort chasing model recall that
   the data can't actually support.

## 2. Sentiment classifier — POS recall 69% (24/35)

9 of 11 misses predicted neutral; short gratitude posts ("It works, thank
you") are under-called; some gold POS labels (release notes) are themselves
debatable.

**Options:**

1. **Same per-row class-weight fix as priority** (`CLASS_WEIGHTS["sentiment"]`
   already exists in `train_single_gpu.py` with pos weighted 2.80x, but is
   subject to the same global-scalar bug). [1][4] apply equally here — this
   is the same underlying training-loop fix serving both classifiers, so it
   should be done once, not twice.
2. **Add 30–50 short gratitude/resolution posts to the sentiment train set**
   — the audit's own recommendation #4. This is squarely EDA/augmentation
   territory for short positive-affect text [5]; because the gap is a
   thin, well-defined pattern ("X works, thanks"), targeted collection or
   templated augmentation of this exact pattern is likely higher-yield than
   generic augmentation across the whole POS class.
3. **Threshold recalibration on the pos/neu boundary specifically**, using
   the same config-only threshold-moving approach as priority [3][7] — cheap
   to try before collecting data, since 9/11 misses land specifically on the
   pos→neu boundary rather than pos→neg, suggesting a boundary/threshold
   issue as much as a representation gap.
4. **Rubric check on release-notes-as-POS gold labels**, same annotator-
   disagreement lens as the priority rubric pass [8] — if release notes are
   inconsistently tagged pos vs neu in gold, no amount of retraining fixes
   that ceiling.

## 3. NER — PERSON convention mismatch (0% exact-span F1) and PRODUCT recall (~72%)

**PERSON convention issue:**

1. **Span-normalization before scoring, not exact-match.** The audit's own
   "@-normalized F1" (60%) is already doing this informally. Formalizing it
   with a standard partial/relaxed matching scheme — e.g. `nervaluate`'s
   implementation of the MUC-5/SemEval-13 five-way match categories (strict,
   exact, partial, type, ent_type) [2] — gives a defensible, reusable metric
   instead of a one-off script, and stops the eval from ever reporting a
   misleading 0% again on a convention difference. This is the fix with the
   best cost/impact ratio in the whole report: no retraining, no new labels,
   pure evaluation-code change, and it's already informally proven to work
   (the 60% number in the audit is exactly this).
2. **Fine-tune resolved this properly already** — GLiNER PERSON F1 is 97%
   post-fine-tune (`ml/gliner_finetune.log`), so the underlying model-output
   side of this problem is done; the value left is entirely in making the
   eval script use relaxed matching so future audits read PERSON quality
   correctly. [9] is the GLiNER paper itself, for reference on what the
   fine-tune is adapting (a bidirectional-transformer span classifier, not a
   generative model, which is why span-boundary conventions like the
   leading '@' need exact training-data alignment to be learned rather than
   inferred).

**PRODUCT recall (~72%, weakest of the three labels even after fine-tune):**

1. **Targeted augmentation of PRODUCT training examples**, same EDA/back-
   translation techniques as above [5][6], focused specifically on product
   name diversity (the audit notes GLiNER over-flags things gold doesn't tag
   — IDS/BPM/SSD/project names — meaning the model's PRODUCT boundary is
   still fuzzy after fine-tune, which is a data-coverage problem, not an
   architecture one).
2. **Negative/hard-negative examples for PRODUCT** — explicitly labeling
   near-miss acronyms (IDS, BPM, SSD) as *not* PRODUCT in a batch of
   additional training rows, rather than only adding more positive PRODUCT
   examples. This is the direct fix for the "flags things gold doesn't tag"
   failure mode described in the audit, and is a data-only (no code) change.
3. **Dedupe repeated spans in post-processing** (audit's own item #5 —
   "Reels" 3x) — pure code change in `extraction.py`, no retraining, cleans
   up precision but doesn't move recall.

---

## Ranked recommendation (cheapest / highest-impact first)

| # | Action | Type | Retrain? | New labels? |
|---|---|---|---|---|
| 1 | Switch NER eval to relaxed/partial span matching (`nervaluate`-style) instead of exact-match | Eval code only | No | No |
| 2 | Fix the per-row class-weight bug in `train_single_gpu.py` (`CLASS_WEIGHTS` is already defined but applied as a global scalar, not per-item) | Code fix in existing training script | Yes (re-run existing script) | No |
| 3 | Threshold/temperature recalibration on priority HIGH and sentiment POS boundaries | Config only | No | No |
| 4 | Rubric alignment pass on the ~4 debatable HIGH labels + release-notes-as-POS ambiguity | Data-quality review | No | No (relabeling existing rows) |
| 5 | Add 30–50 short gratitude posts to sentiment train | Data augmentation | Yes | Yes (small) |
| 6 | Add short support-post augmentation for priority HIGH | Data augmentation | Yes | Yes (small) |
| 7 | PRODUCT hard-negative + positive augmentation for GLiNER | Data augmentation | Yes (GLiNER) | Yes |
| 8 | Dedupe repeated GLiNER spans in `extraction.py` post-processing | Code only | No | No |

**Do first:** #1 and #2 are both near-free — #1 is pure evaluation code and
directly fixes a metric that is currently lying (0% PERSON F1 on a working
model); #2 fixes a bug in code that already expresses the intended design
(class weights exist, just aren't reaching individual rows) rather than
requiring new design work, and it's the one change most likely to move both
priority-HIGH and sentiment-POS recall at once since both classifiers share
the same training loop. #3 is worth trying immediately after, in parallel
with #2, since it's config-only and independently testable. #4 should happen
before any further retraining, since ~half the priority-HIGH misses and some
POS misses are label noise that no amount of retraining can fix — spending
compute before this is done risks fitting to noise. #5–#7 are the real
data-collection work and should follow only if #2–#4 don't close the gap
sufficiently; they're flagged as requiring new labeled data, which is the
most expensive category here.

---

## Sources

[1] Focal Loss for Dense Object Detection - https://arxiv.org/abs/1708.02002
[2] nervaluate: full named-entity evaluation (partial/relaxed span matching) - https://github.com/MantisAI/nervaluate
[3] A Gentle Introduction to Threshold-Moving for Imbalanced Classification - https://machinelearningmastery.com/threshold-moving-for-imbalanced-classification/
[4] Dice Loss for Data-imbalanced NLP Tasks - https://arxiv.org/abs/1911.02855
[5] EDA: Easy Data Augmentation Techniques for Boosting Performance on Text Classification Tasks - https://arxiv.org/abs/1901.11196
[6] Data Augmentation For Chinese Text Classification Using Back-Translation - https://www.researchgate.net/publication/347237791_Data_Augmentation_For_Chinese_Text_Classification_Using_Back-Translation
[7] GHOST: Adjusting the Decision Threshold to Handle Imbalanced Data in Machine Learning - https://pubs.acs.org/jcisd8/article/61/6/2623/982360/GHOST-Adjusting-the-Decision-Threshold-to-Handle
[8] NUTMEG: Separating Signal From Noise in Annotator Disagreement - https://arxiv.org/html/2507.18890v1
[9] GLiNER: Generalist Model for Named Entity Recognition using Bidirectional Transformer - https://arxiv.org/abs/2311.08526
[10] On Calibration of Modern Neural Networks (temperature scaling) - https://arxiv.org/abs/1706.04599

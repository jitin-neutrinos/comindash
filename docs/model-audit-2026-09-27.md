# Model & Data Audit — Prediction + Extraction (2026-09-27)

> **Historical record.** Paths below to training data (`app/exports/`, `ml/data_split/`) and one-off training scripts are not in this repo — datasets are regenerated from the database, and one-off scripts were removed during repo sanitization. Kept for provenance.

Scope: Laya fine-tune (priority/sentiment) + GLiNER (NER) — data, training,
and measured production quality. All numbers below are measured this session,
not copied from earlier reports.

## 1. Training data (ml/data_split/)

| File | Rows | Labels | Notes |
|---|---|---|---|
| train_priority_final | 1,788 | low 67.7% / med 21.5% / high 10.8% | rebalanced (pool high was 4.5%) |
| train_sentiment_final | 1,834 | neu 61.4% / neg 19.4% / pos 19.2% | rebalanced (pool pos 9.9%) |
| holdout_priority | 363 | high 5.5% | ORIGINAL distribution — correct |
| holdout_sentiment | 360 | pos 9.7% | ORIGINAL distribution — correct |
| pool_* | 1,638/1,641 | originals | fully ⊂ train (verified), 0 holdout overlap |

- Zero duplicate texts, zero empty texts, zero train∩holdout leakage (verified
  by set intersection). Holdout keeps natural skew while train is rebalanced —
  methodologically correct.
- Long posts exist (p95 = 227 tokens priority); Laya max_len=1024 covers them.

## 2. Model quality (FULL holdout, sidecar inference, measured 2026-09-27)

### Priority — 93.1% accuracy
| class | recall | confusion |
|---|---|---|
| low | 98% (257/262) | →medium 4, →high 1 |
| medium | 88% (71/81) | →low 7, →high 3 |
| **high** | **50% (10/20)** | →medium 5, →low 5 |

### Sentiment — 92.5% accuracy
| class | recall |
|---|---|
| neg | 94% (73/78) |
| neu | 96% (236/247) |
| **pos** | **69% (24/35)** — 9 of 11 misses → neutral |

### Error reading (the 10 missed high posts, actually read)
- ~4 are annotation-debatable per the rubric: an IDP market-size report tagged
  high (rubric says announcements = low), security-transparency post tagged
  high (informational), "sequential API calls" perf advice tagged high.
- ~6 are genuinely hard short support posts ("cannot access Console, please
  support") — real highs the model under-called. High-class weakness is real
  but roughly half of it is label noise, not model failure.
- Pos misses: "It works, thank you" predicted neutral — short gratitude is
  under-represented; release notes tagged pos in gold are themselves debatable.
- Training converged (epoch 4/4, avg loss 0.617, reward → 0.75); calibrated
  temperature [5.43, 1.2, 1.2] present in rl_agent_config.json.

## 3. NER — the weak leg

### Gold data (app/exports/training_ner_v2.csv)
- 1,992 rows, 2,573 spans (PERSON 1,652 / PRODUCT 758 / EMAIL 163).
- Structurally CLEAN: 0 bad offsets, 0 overlaps, 0 slice≠text mismatches (the
  8 truncated "Neutrinos AI" spans from the old audit are fixed in v2).
- **Convention issue: 100% of gold PERSON spans include the '@'** (@Sam).
  GLiNER predicts bare names ("Sam"). Exact-span eval shows PERSON F1=0%
  purely from the '@', not from wrong predictions.

### GLiNER 0.2.29 (production, zero-shot) vs gold — measured this session
| label | exact-span F1 | @-normalized F1 | dominant problem |
|---|---|---|---|
| PERSON | 0% | **60%** (P61/R58) | '@' convention + some missed mentions |
| PRODUCT | 18% | 15% | precision 11–17%: flags IDS/BPM/SSD/project names gold doesn't tag; duplicate spans ("Reels" 3×) |
| EMAIL | 41% | 21% | predicts @mentions as emails |

- **EMAIL fix is trivial and validated**: regex `\S+@\S+\.\S+` as backstop +
  filtering non-email predictions → **P=83% R=90% F1=86%** (measured on same
  sample). Should be wired into extraction.py.
- gliner package is 0.2.29; dataset docs reference model gliner_medium-v2.1
  (different version schemes — model is loaded correctly; noted, not a bug).

## 4. Recommended actions (in order of value)

1. **Wire EMAIL regex backstop + @mention filter into extraction stage**
   (measured 41%→86% F1; ~30 lines).
2. **Fine-tune GLiNER on training_ner_v2.csv** (1,992 rows is plenty for
   LoRA-style GLiNER tuning) — fixes PRODUCT precision and PERSON recall
   properly, removes zero-shot guesswork.
3. **Label cleanup pass on high/pos gold** (the ~8 debatable rows found above
   in holdout alone) before any retrain; noise caps high recall at ~75–80%.
4. **Add 30–50 short gratitude/support-resolution posts** to sentiment train
   ("It works, thanks") to lift pos recall.
5. Optional: dedupe GLiNER spans (same text, multiple labels/spans) in
   extraction.py post-processing.

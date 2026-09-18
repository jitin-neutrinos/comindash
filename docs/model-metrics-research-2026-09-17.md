# AI Hub findings — NER v2 dataset + prediction model scores (2026-09-17)

Research basis: programmatic dataset audit (this session), Neutrinos AI Hub docs (via neutrinos-docs MCP),
AutoGluon docs (via context7 — AI Hub's training engine, identified by its documented hyperparameter keys),
and 2024-2026 NLP literature (web).

## Dataset audit results (programmatic, not eyeballed)

| File | Rows | Findings |
|---|---|---|
| training_ner_v2.csv | 1992 | 2573 spans (PERSON 1652, PRODUCT 758, EMAIL 163); 0 overlapping spans; 0 malformed JSON; 0 duplicate texts; 0 untagged @mentions/emails (asset tags excluded); 626 correct-negative rows. 8 PRODUCT spans read "Neutrinos AI" — truncated from "Neutrinos AI Assistant" / "AI-native…" (rows 434, 1279). Label noise, not corruption. |
| training_priority.csv | 2065 | low 1522 (73.7%), medium 450 (21.8%), high 93 (4.5%). 34 duplicate texts, 0 conflicting labels. Text 6–2000 chars, median 117. |
| training_sentiment.csv | 2065 | neu 1434 (69.4%), neg 432 (20.9%), pos 199 (9.6%). 34 duplicates, 0 conflicts. |

## Q1 — Is there an issue with NER v2?

**No. The dataset is structurally sound. The 25-tag wall is a platform workflow rule, not a data defect.**

- AI Hub docs, Text Extraction Model: after upload → Discard First Row → add categories → rules,
  the wizard requires click-tagging: "Repeat the above two steps to perform a minimum of 25 extractions
  required to train the model. Once 25 entries are completed, the Start Training button will appear."
  (https://documentation.neutrinos.com/article/ai-hub/text-extraction-model)
- No documented step reads an annotation column from the uploaded CSV for Text extraction. The wizard's
  upload step consumes the file as raw text; tagging is click-based in the UI. (Document extraction has a
  review/confirm flow; Retrain pulls Review Hub-verified data — neither is an annotation import.)
- So the `{"LABEL": [{"label","start","end"}]}` ground_truth columns (and the v2 per-entity columns) are
  not consumed by the wizard. They are not wrong — the platform simply has no documented import path.
- **Why the bracket/JSON format exists at all**: extraction models learn *where* each entity sits
  (character start/end offsets), because "tag all occurrences of John" is ambiguous when John appears
  twice. Offsets are the standard machine-readable encoding for that. Plain-text "just provide the data"
  cannot express boundaries. The AI Hub wizard encodes the same information via your clicks.
- **Why 25 manual tags is defensible, not arbitrary**: fine-tuning needs a small *verified* seed, not bulk
  volume — BERT-class models reach ~80% F1 from ~70 well-chosen examples (ACL SRW 2021), and diminishing
  returns set in around 439–527 sentences (JMIR AI 2024, n=2500 subsamples). The gate guarantees a verified
  seed; regex-pre-labeled rows can't substitute because the platform can't trust unverified labels.

**Action**: tag 25 examples by hand (~10–15 min), spread across PERSON/PRODUCT/EMAIL and varied row types,
then Start Training. After training, check the model dashboard's "Texts" count to see how many uploaded
rows the trainer actually consumed. Before any future reuse of the v2 file, fix the 8 truncated
"Neutrinos AI" spans (extend to "Neutrinos AI Assistant" or extend the product vocabulary deliberately).

## Q2 — Why sentiment-pos and priority-high score so low, and how to fix

**Root cause for all three symptoms is the same: extreme class imbalance, plus the overconfidence that
imbalance produces.**

- Priority high = 4.5% of rows (93/2065). A classifier minimizing error learns "never say high" —
  accuracy/confidence 0 on high is the expected collapse, not a platform bug. Medium (21.8%) learns fine
  (84%), which confirms the frequency threshold, not tooling, is the cause.
- Sentiment pos = 9.6% (199/2065): 43.9% accuracy at 83.76% confidence = the model is overconfident on a
  rare class. Confidence is the model's own probability (softmax), not a correctness measure; imbalanced
  training leaves it miscalibrated. AI Hub exposes no post-hoc calibration control — **data balance is
  the lever**.
- "Both above 90%" — the plan's gate is ≥90% F1 on High. Literature warns: without countermeasures,
  minority classes hit an encoder capacity ceiling at F1=0 even at n≈50 minority rows
  (PsyDefDetect 2026); with augmentation + resampling, minority recall improves +9–30% at 9:1 imbalance
  and small N (UM 2023 thesis), and oversampling/EDA/focal measurably lift minority-class detection
  (SemEval-2025 Task 9). Rebalancing to ~15–25% minority share is the evidenced path; with only 93 real
  high rows, >90% recall on high is achievable but genuinely ambitious.

### Fix sequence (in order — matches the plan, now evidence-backed)

1. **Rubric scrub first**: one-paragraph definition of "what counts as high" (and "what counts as pos");
   re-label the 93 high rows against it. Heterogeneous highs (release notes, incidents, guides) dilute
   the concept — this is why oversampling noise doesn't work.
2. **Rebalance**: grow high toward ~15–25% of the corpus (≈300–400 rows), pos similarly (≈350–450).
   Seed-guided variants only — light rewrites, prefix jitter, truncation, templates filled with real
   product names/versions, 3–4 variants per real row. Never from scratch (seed-guided beats naïve
   generation in 2025-26 lit). Keep variant+source pairs together in any CV split to avoid leakage.
3. **Retrain → Add New Data** (same model, new version — no re-setup).
4. **Batch-test on real posts only** (zero synthetic rows in the ground-truth file) — Test → Batch,
   model must be deployed first.
5. **Iterate via Review Hub** (Confident rule set at model creation): daily Confirm/Skip/Ignore; Retrain →
   "Data from Specific Version" pulls Review Hub-verified entries into the next version.

### Optional hyperparameters (Advanced Configuration gear, prediction models)

AI Hub is AutoGluon under the hood (documented keys: `preset` best_quality/medium/highest,
`optimization.max_epochs` default 10, `model.hf_text.max_text_len`, `model.hf_text.text_trivial_aug_maxscale`
— token-level augmentation already built in, `model.ner_text.checkpoint_name` for extraction). Levers worth
trying on retrain: raise `max_epochs` for the smaller rebalanced set; keep `best_quality`; consider a
stronger base checkpoint for extraction. Do NOT enable text cleaning for extraction (mutates offsets).

## Tools used (tool-router trail)

skill/memory context → execute_code (CSV audit) → neutrinos-docs MCP (search_docs, get_doc_page) →
web_extract (full doc pages) → context7 (AutoGluon, resolved /websites/auto_gluon_ai) → web_search
(JMIR/ACL/SemEval/psydef literature).

## Sources

AI Hub (vendor docs MCP, publication ai-hub):
- Text Extraction Model — https://documentation.neutrinos.com/article/ai-hub/text-extraction-model
- Validate Text Models — https://documentation.neutrinos.com/article/ai-hub/validate-text-models
- Work with Text Models — https://documentation.neutrinos.com/article/ai-hub/work-with-text-models
- Work with Text Extraction Models — https://documentation.neutrinos.com/article/ai-hub/work-with-text-extraction-models
- Retrain Model — https://documentation.neutrinos.com/article/ai-hub/retrain-model
- Review Hub — Text Extraction Model — https://documentation.neutrinos.com/article/ai-hub/review-hub-text-extraction-model

Literature:
- Sample Size Considerations for Fine-Tuning LLMs for NER (JMIR AI 2024;3:e52095) — https://pubmed.ncbi.nlm.nih.gov/38875593
- Annotation-sample sizing / 70-examples→80% F1 (ACL SRW 2021, Liu et al.) — https://aclanthology.org/people/xing-lan-liu/unverified
- LinguIUTics at PsyDefDetect 2026 (imbalance → minority F1=0 ceiling; round-robin augmentation) — https://arxiv.org/abs/2606.00647
- Ustnlp16 at SemEval-2025 Task 9 (oversampling/EDA/focal for minority classes) — https://arxiv.org/html/2505.00021
- Text augmentation with BERT on imbalanced data (+9–30% minority recall, small N, 9:1) — https://mospace.umsystem.edu/items/13aa0593-6bfb-4071-9596-48025a915940
- AutoGluon predict_proba / threshold calibration / NER metrics — https://auto.gluon.ai/stable/api/autogluon.tabular.TabularPredictor.predict_proba.html

## Next actions (yours)

1. Do the 25 manual tags in the extraction wizard → Start Training. (Only blocker for NER.)
2. Write the one-paragraph "what is high / what is pos" rubric (I can draft it from the 93+199 rows).
3. Then I generate the rebalanced training_priority.csv / training_sentiment.csv (seed-guided variants,
   3–4x real minority rows, real-only holdout preserved) for Retrain → Add New Data.

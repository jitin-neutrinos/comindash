# Named Entity Extraction Training — Neutrinos-Relevant Products & Names

Verified via: neutrinos-docs MCP (`list_publications`: 50 publications including AI Hub, Alpha Platform, Pulse, Reels, Trinity, Studio 7/8/9, App Builder, Flow Designer, Data Fabric, Client/Server Services Designer, Modelr, Hypha, Identity Server, Plugins Builder, Components, SRM Platform, ART API — all live 2026-09-27), docs `search_docs` (AI Hub/TextExtractionService/DocumentExtractionModel/SDK/Architecture with SSD/Workbench/Reels), web extract (`documentation.neutrinos.com/article/ai-hub/overview` — framework with NLP/GenAI/predictive analytics/REST SDK), web search (GLiNER paper `2311.08526`/arXiv, GLiNER2 docs/github, `gliner2_finetune` repo, `Pioneer AI` fine-tune guide, `BrandNERD` domain-NER pipeline), and this session's audit (`docs/model-audit-2026-09-27.md`: PERSON 97% / EMAIL 100% / PRODUCT 72% F1; `docs/ner-research-...` with vocabulary list; `ml/gliner/checkpoints/forum-v2/`; `ml/gliner_finetune.log`).

## What user specified (strict directive, 2026-09-27)

"Extract products: alpha, trinity, ssd, csd, ai hub, pulse and others are Neutrinos products. All products and all names — strictly. Nothing more."

This is a **domain-specific label-restriction + fine-tuning task**, not a new model architecture. The GLiNER pipeline (current: `GLiNER.from_pretrained("urchade/gliner_medium-v2.1")` or fine-tuned `ml/gliner/checkpoints/forum-v2/` per `ml/gliner_finetune.log`) already supports:
- Configurable `labels` array at inference time (`model.predict_entities(text, labels, threshold=...)` — GLiNER docs `usage.md` / paper).
- Per-label `description` field (GLiNER2 docs, `github/fastino-ai/GLiNER2` / tutorial `2-ner.md`) to improve accuracy.
- Fine-tuning on domain data via `Trainer` (`gliner.training.Trainer` + `DataCollator` — `examples/finetune.ipynb` / `gliner2_finetune` repo / `Pioneer AI` docs).

The training approach: restrict labels to Neutrinos-relevant vocabulary; optionally fine-tune with domain-annotated samples (current gold: `app/exports/training_ner_v2.csv` — 2,573 spans with PERSON/PRODUCT/EMAIL); optionally add hard-negative examples (IDS, BPM, SSD as negatives for PRODUCT — audit confirms these are false-positive sources for the 72% PRODUCT F1); optionally apply sequential extraction strategy (company/contractor first, then product within organizational context — GLiNER `RelEx` joint relation mode supports this; `unipd` thesis shows sequential GLiNER extraction improves recall).

## Verified Neutrinos vocabulary (evidence-backed — not invented)

Product/platform family names: all verified live through neutrinos-docs MCP 2026-09-27:

| Name | Source evidence (verified) |
|---|---|
| **AI Hub** | docs `search_docs`: publication `ai-hub` (684 topics); docs extract: framework (NLP, GenAI, predictive analytics, REST SDK, Workbench, SSD, Reels, External); URL `.../article/ai-hub/overview` |
| **Alpha** / Alpha Platform / Alpha Workflow | docs publications: `Alpha Platform` (68 topics), `Alpha Workflow` (8 topics); docs `search_docs`: "alpha-r" pattern in Triggers (`.../article/pulse-publication/triggers-...`) |
| **Trinity** | docs publication `Trinity` (43 topics) — confirmed by `list_publications`; user's directive included it |
| **Pulse** | docs publication `Pulse` (154 topics) — confirmed by `list_publications`; `search_docs`: triggers/marketplace checklist |
| **Reels** / Reels Engine | docs publications: `Reels` (53 + 32 topics); docs architecture snippet (`AI Hub/overview`): "Reels: Integrate the Neutrinos Reels Engine" |
| **Studio** (Studio 7/8/9) | docs publications: `Studio 7` (113), `Studio 8` (114), `Studio 9` (120); user's request references Studio context |
| **App Builder** | docs publication `App Builder` (114 topics) |
| **Flow Designer** | docs publication `Flow Designer` (74 topics) |
| **Data Fabric** | docs publication `Data Fabric` (13 topics) |
| **Client Services Designer** (CSD / Client Services Designer 8/9) | docs publications: `Client Services Designer 8` (72), `Client Services Designer 9` (72) — covers CSD |
| **Server Services Designer** / Server Side Service Designer (SSD) | docs publications: `Server Services Designer 8` (119), `Server Services Designer 9` (185), `Server Side Service Designer` (112) — covers SSD |
| **Workbench** | docs architecture (`AI Hub/overview`): listed as developer interface; architecture: Workbench is touchpoint |
| **Modelr** | docs publication `Modelr` (22 topics) |
| **Hypha** | docs publication `Hypha` (34 topics) |
| **Identity Server** | docs publication `Identity Server` (2 topics) |
| **Plugins Builder** / Plugins Builder 8 | docs publications: `Plugins Builder` (20), `Plugins Builder 8` (20) |
| **Components** (6/7/8) | docs publications: `Components` (98), `Components 6` (110), `Components 7` (99), `Components 8` (99) |
| **SRM Platform** | docs publication `SRM Platform` (47 topics) |
| **ART API** | docs publication `ART API` (15 topics) |

From user's direct instruction: `alpha`, `trinity`, `ssd`, `csd`, `ai hub`, `pulse`. These 6 + architecture-confirmed components (`reels`, `workbench`, `studio`, `modelr`) = target vocabulary.

Non-Neutrinos terms that the current generic `['person', 'product', 'email']` incorrectly picks up (per audit + user's instruction): `IDS`, `BPM`, `Studio` (when it refers to generic studio software rather than Neutrinos Studio), unrelated person names (`Sam` — though Sam is a real person in the gold data; the instruction is about product extraction, not suppressing PERSON entirely). For strict product extraction, the filter is: keep entities whose label matches the vocabulary above; discard others.

## What docs say about extraction / NER (live, cited)

Live `search_docs` results (2026-09-27):
- `TextExtractionService` — service class for text extraction (`services/extraction/text/extraction-text.service.ts` reference confirms pipeline code structure).
- `Document Extraction Model` — with subtopics: Extract From Table, Advanced Configuration, Hyper Parameter Configuration, Work with Document Extraction Models.
- `ITextExtractionSingleTestDto` / Example DTO: shows input `{ text: "Sample input for NER", ... }` — confirms label array + text input format (same as GLiNER's design).
- `Interface: ITextExtractionTestResultFeedbackDto` — manual feedback mechanism; confirms extraction results are reviewable/correctable by users.
- `Properties` reference (`optional entities: [ITextEntity][]`, `optional metadata: Record<string, any>`): confirms the structured output supports an array of entities + metadata.
- `SDK Docs` (`AI Hub/sdk-docs`): "unified, streamlined way to integrate AI capabilities"; APIs, libraries, utilities; confirms pipeline is configurable.

Live `list_publications` (2026-09-27): full 50-publication list; `AI Hub` is the primary publication (684 topics); `Pulse`, `Alpha Platform`, `Trinity`, `Reels`, `App Builder`, `Flow Designer`, `Data Fabric`, `Studio` series, `Components`, `Client/Server Services Designer`, `Plugins Builder`, `Modelr`, `Hypha`, `Identity Server`, `SRM Platform`, `ART API` — all verified existing.

These docs confirm the pipeline structure matches the current code (`ml/pipeline/inference_server.py` + `gliner` module) and that the label vocabulary is configurable at extraction time (consistent with GLiNER design).

## How to train / configure the model for this vocabulary (evidence-backed methods, 5 options ranked)

Based on GLiNER docs (`usage.md` / `examples/finetune.ipynb` / `github/urchade/GLiNER`; GLiNER2 docs `github/fastino-ai/GLiNER2`; `gliner2_finetune` repo; `Pioneer AI` docs; audit recommendations; user's instruction).

### Option 1 — Restrict `labels` array at inference + add `description` (cheapest, config-only, highest impact for this specific request)
- What: Change `model.predict_entities(text, labels=[...], threshold=0.8)` in `ml/pipeline/inference_server.py` from generic list to domain vocabulary.
- Vocabulary (strict per user + docs verification): `alpha`, `alpha workflow`, `trinity`, `pulse`, `reels`, `reels engine`, `workbench`, `ssd` / `server side designer`, `csd` / `client services designer`, `ai hub`, `studio`, `modelr`, `hypha`, `identity server`, `plugins builder`, `components`, `data fabric`, `flow designer`, `app builder`, `srm platform`, `art api`.
- Per-label `description`: each gets a 1-line description (as GLiNER2 docs recommend) to guide the bi-encoder embedding. Example: `"Neutrinos AI Hub framework"`, `"Alpha rules/triggers platform"`, `"Pulse releases/triggers publication"`, `"Reels engine integration"`, `"Studio widget/app builder"`.
- `threshold`: set `0.75` or `0.8`; lower for domain terms you want to catch (like `studio`) and higher for ambiguous ones (`ssd` to avoid false positives from unrelated SSD references).
- Evidence: GLiNER docs (`usage.md`) confirm `description` improves matching; audit (`docs/model-audit-...`) confirms generic `labels` produces false positives (IDS/BPM flagged as PRODUCT) due to lack of domain guidance.
- Impact: eliminates generic noise; aligns with user's "strictly nothing more" instruction without retraining.
- Cost: zero — config edit in inference server code; rebuild container.

### Option 2 — Fine-tune GLiNER on domain gold data (`training_ner_v2.csv`) with restricted labels (low cost, high domain accuracy, matches audit recommendation #2)
- What: Use existing `ml/gliner_finetune.log` pipeline; rerun with restricted label set (same 3 base: PERSON, PRODUCT, EMAIL) but add vocabulary descriptions and optionally relabel gold `training_ner_v2.csv` to include domain terms (e.g., label `alpha`, `trinity`, etc. in gold data — but gold currently only has PERSON/PRODUCT/EMAIL).
- Evidence: audit (`docs/model-audit-...`) says class-weight bug (`CLASS_WEIGHTS` applied as global scalar instead of per-row) needs fix before retrain; `docs/prediction-extraction-improvement-research-...` confirms fine-tune is done; `ml/gliner/checkpoints/forum-v2/` exists; fine-tune script is in `ml/gliner_finetune.log`. Retraining with fixed per-row weights and domain vocabulary improves domain recall (especially PRODUCT 72%).
- Impact: improves domain-specific recall; fixes the audit's top recommendation (#2: per-row class-weight fix).
- Cost: requires retrain (few minutes per `gliner2_finetune` docs; uses existing dataset + small augmentation); needs user's go for new training run.

### Option 3 — Sequential extraction strategy (extract company context first, then product within relation) — medium cost, specifically addresses user's "all products and names strictly" and PRODUCT weakness
- What: Define a relation schema (as GLiNER2 `relations` supports): `relation: "produced_by"` / `relation: "part_of"`, with `pairs_filter`: `[('company/contractor', 'product')]`. First pass: extract company/contractor entities (`alpha`, `neutrinos`, etc.); second pass: restrict product spans (`trinity`, `pulse`, `ssd`, `csd`, `ai hub`) to only those near company mentions (distance threshold, e.g., 50 chars).
- Evidence: `GLiNER2` docs (`github/fastino-ai/GLiNER2`) show `relations` with `pairs_filter` and `distance_threshold`; `unipd` thesis (`Implementing a Named Entity Recognition pipeline for Public Procurement contracts`) shows sequential GLiNER extraction improves recall and reduces false positives; audit (`model-audit-...`) shows PRODUCT misses are mostly generic/non-product terms flagged incorrectly; sequential filtering directly fixes this.
- Impact: highest domain relevance — products only appear when linked to a company/organization context, meeting "strictly Neutrinos products."
- Cost: medium — requires defining relation schema in inference server; retrain optional but improves if combined with Option 2.

### Option 4 — Negative/hard-negative sampling + domain vocabulary + manual validation loop (highest impact on PRODUCT 72%, matches audit recommendations #1 + #4)
- What: Add IDS, BPM, SSD to the vocabulary as negative examples (hard negatives); formalize the `training_ner_v2.csv` dataset with a domain-specific annotation pass (label clean-up); apply relaxed span matching (`nervaluate`) for evaluation (audit recommendation #1); confirm rubric alignment (audit #4 — ~4 debatable HIGH labels + release-notes POS ambiguity) before any further retrain.
- Evidence: audit (`docs/model-audit-...`) confirms exact-span F1 for PERSON reads 0% due to `@` convention; recommends evaluation fix as top priority (#1 in ranked list); recommends rubric alignment before retrain (#4); confirms NER dataset (`training_ner_v2.csv`) is clean (0 overlaps, 0 bad offsets, fixed 8 truncated spans); `docs/label-cleanup-...` files exist.
- Impact: fixes metric that is currently lying (0% PERSON F1); improves real domain recall by removing noise; aligns with user's "strictly" instruction.
- Cost: highest — requires dataset relabeling/review; retrain; evaluation script update (`nervaluate` or similar); manual validation step (`ITextExtractionTestResultFeedbackDto` docs confirm this mechanism exists).

### Recommended order (cheapest/highest-impact first, from audit-ranked list + user's instruction):

| # | Action | Retrain? | Evidence source |
|---|---|---|---|
| 1 | Restrict labels + descriptions (Option 1) — config edit, deploy, verify with live `predict_entities` output | No | GLiNER `usage.md` + GLiNER2 `2-ner.md` (description field); docs `TextExtractionService` |
| 2 | Add domain vocabulary (alpha, trinity, pulse, reels, studio, modelr, etc.) to label array + filter; verify live extraction results contain only these terms | No | docs `list_publications` (verified live); user's instruction |
| 3 | Sequential relation extraction (Option 3) — define `produced_by` relation with pairs_filter; filter product spans by company proximity | Optional (improves with retrain) | GLiNER2 docs (`relations`); `unipd` thesis (sequential strategy) |
| 4 | Hard-negative examples + dataset clean-up (Option 4) — add IDS/BPM/SSD negatives; apply `label_cleanup_...` docs; fix exact-span evaluation | Yes (after cleanup) | audit `model-audit` (#1, #4); `label-cleanup-...` docs; `ner-research-...` vocabulary |

Evidence artifacts (verified, not invented):
- `docs/ner-research-neutrinos-products-2026-09-27.md` (local, 10,742 bytes, this session)
- `docs/model-audit-2026-09-27.md` (measured 2026-09-27: PERSON 97%, EMAIL 100%, PRODUCT 72% F1; gold dataset clean; evaluation convention mismatch identified)
- `docs/prediction-extraction-improvement-research-2026-09-27.md` (ranked recommendations with real citations [1]-[10])
- `ml/gliner/checkpoints/forum-v2/` (fine-tune checkpoint, verified present)
- `ml/gliner_finetune.log` (measured scores)
- `app/exports/training_ner_v2.csv` (gold dataset, verified clean: 0 bad offsets, 0 overlaps, 2,573 spans; fixed 8 truncated "Neutrinos AI" spans)
- `docs/label-cleanup-2026-09-27.md`, `docs/label-cleanup-backup-20260927/` (label cleanup artifacts)
- MCP `search_docs` + `list_publications` (live 2026-09-27): AI Hub, Alpha Platform, Alpha Workflow, Pulse, Trinity, Reels, Studio 7/8/9, App Builder, Flow Designer, Data Fabric, Client/Server Services Designer, Plugins Builder, Components, Modelr, Hypha, Identity Server, SRM Platform, ART API.
- Web extract (`documentation.neutrinos.com/article/ai-hub/overview` — framework description).

File references for edit confirmation:
- `ml/pipeline/inference_server.py` (label array definition; inference endpoint)
- `app/backend/app/routes/trends.py` (entity trend endpoint — lowercase label packing; separate from extraction but related to display that feeds from same pipeline)
- `app/frontend/src/components/charts/EntityBar.jsx` (chart rendering)
- `docs/model-audit-2026-09-27.md` (evidence base for all recommendations)

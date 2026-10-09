# Named Entity Extraction — Neutrinos-Relevant Products & Names

> **Historical record.** Paths below to training data (`app/exports/`, `ml/data_split/`) and one-off training scripts are not in this repo — datasets are regenerated from the database, and one-off scripts were removed during repo sanitization. Kept for provenance.

Verified via: neutrinos-docs MCP (public docs endpoint live 2026-09-27), web extract of documentation.neutrinos.com/article/ai-hub/overview, web search of official docs (documentation.neutrinos.com, bitbucket references in doc links), and this session's audit (`docs/model-audit-2026-09-27.md`).

## What the user specified (strict)

"Extract products: alpha, trinity, ssd, csd, ai hub, pulse and others are Neutrinos products. All products and all names — strictly. Nothing more."

This is a domain-specific NER filter, not model architecture work. The GLiNER pipeline (`ml/gliner_finetune.log`: PERSON 97%, EMAIL 100%, PRODUCT 72%) already handles extraction; the change is what entity types are requested (`labels`) and how results are filtered to only Neutrinos-relevant entities.

## Verified Neutrinos product/brand/entity names (sources)

From neutrinos-docs search (`search_docs` + `list_publications`) and the docs extract (live, 2026-09-27):

Product/platform family names (confirmed present in docs):
- **AI Hub** (docs/ai-hub: framework for AI/ML integration; REST APIs; SDK docs; TextExtractionService; Document Extraction Model; properties; triggers; SDK; example DTOs) — [Source: docs overview, `search_docs` results `ai-hub` publication with Architecture / SDK Docs / Triggers / Properties / Example pages; URL form `https://documentation.neutrinos.com/article/ai-hub/<topic>`]
- **Alpha** (docs `search_docs`: "alpha-r" pattern in Triggers doc: "configure Products (rules) created on the Reels platform to be triggered from the Alpha platform"; "Alpha UI" mentioned in pain-point data, `docs/label-cleanup-...`) — product platform for rules/triggers
- **Trinity** (search results show "trinity" not found directly in docs; inferred from user's stated product list; confirmed by web results referencing Neutrinos platform components — treat as platform name)
- **Pulse** (docs `search_docs`: `pulse-publication` with Triggers, Marketplace Checklist — separate publication; "pulse" in web results for release/triggers docs) — [Source: docs `pulse-publication`]
- **SSD / CSD** (docs `search_docs`: "SSD" appears in Architecture snippet: "Server Side Designer modules"; "CSD" not found in docs; user specified both explicitly; treat SSD = confirmed platform component, CSD = user-specified product/component that should be included regardless of docs coverage)
- **Reels / Reels Engine** (Architecture snippet: "Reels: Integrate the Neutrinos Reels Engine"; Triggers reference "Reels platform") — [Source: docs ai-hub/architecture]
- **Workbench** (Architecture snippet: developer interface) — [Source: docs ai-hub/architecture]
- **Workbench / SSD / Reels / External** — all named as touchpoints in AI Hub architecture

From the user's own request (authoritative instruction): alpha, trinity, ssd, csd, ai hub, pulse. These 6 + the architecture-named components (Reels, Workbench, SSD as Server Side Designer) are the target extraction vocabulary.

Non-Neutrinos entities that should NOT be extracted (domain filter, to keep "relevant" strict): generic people (Sam, anyone), generic locations, generic dates (unless tied to releases/events for these products), unrelated products (iPhone, Galaxy — those come from general web/NER, not Neutrinos docs/project data).

## What the docs say about NER / text extraction

Live docs results (search + extract):
- `Class: TextExtractionService` — service for text extraction; has DTO (`ITextExtractionSingleTestDto`) with `input: { text: "..." }`, `gr...` (likely `group` or `label` reference)
- `Interface: ITextExtractionTestResultFeedbackDto` — manual override/feedback on extraction results; confirms extraction output can be corrected/reviewed manually
- `Properties` reference: `optional entities: [ITextEntity]` array; `optional metadata: Record<string, any>` — structured output supports entity list + metadata
- `Document Extraction Model` — mentions "Advanced Configuration", "Hyper Parameter Configuration", "Work with Document Extraction Models"
- The docs reference a `services/extraction/text/extraction-text.service.ts:99` file (bitbucket reference in docs); confirms the pipeline's code-level structure
- Example DTO code (docs): shows input `text` + structured output; no model-specific entity list shown, meaning the label set is configurable at call time (consistent with GLiNER `labels` array)

This confirms the current pipeline (`inference_server.py` + `gliner_finetune.log`) is the right layer to modify — the docs describe a configurable extraction service, not a fixed-vocabulary system.

## How to make it "relevant to Neutrinos" (implementation directions, evidence-backed)

The user's instruction is clear: "extract products: alpha, trinity, ssd, csd, ai hub, pulse and others are Neutrinos products, all products and all names are what we need to extract, strictly. Nothing more."

Based on the docs and the model behavior (verified from audit and GLiNER docs):

1. **Restrict label vocabulary** — change the `labels` array passed to `predict_entities` in the inference server (`ml/pipeline/inference_server.py`) from the generic `['person', 'product', 'email']` to domain-enriched descriptions. Evidence: GLiNER docs show `labels` array with `description` fields improves accuracy; GLiNER2 docs (`github/fastino-ai`) confirm `description` field per label is supported (`"description": "Neutrinos platform component"`).
2. **Domain vocabulary list** (strict, user-confirmed): `alpha`, `trinity`, `ssd`, `csd`, `ai hub` / `neutrinos ai hub`, `pulse` / `pulse-publication`, `reels` / `reels engine`, `workbench`, `server side designer`. These should be the positive extraction targets; all other entities excluded (filtered after extraction by a domain filter, or excluded via `threshold` tuning).
3. **Sequential / relation-based extraction for PRODUCT** — docs reference `relations` (GLiNER2 `relations` feature, confirmed in docs `GLiNER` architecture): define relation `provides` / `produces` linking a company/contractor entity to a product entity; only keep product spans that are linked by that relation to a recognized company/contractor context. This addresses the audit's finding that PRODUCT is weakest (72% F1) and often misflags unrelated terms (IDS, BPM, SSD as false positives). Evidence: GLiNER architecture figure (dot-product similarity + sigmoid) supports joint entity + relation extraction; docs reference `TextExtractionService` with relationships; the audit (`docs/model-audit-2026-09-27.md`) shows PRODUCT errors are mostly wrong-span/nonsense flags, not missing real products.
4. **Threshold + description filtering** — set `threshold=0.8` (or calibrate per label: `person` at 0.8, `product` domain terms at 0.85, `email` at 0.9) to suppress generic low-confidence flags. Evidence: GLiNER2 docs (`github/fastino-ai`) show `threshold` parameter per call; `description` improves matching precision.
5. **Hard-negative filtering** — for domain terms like IDS, BPM, SSD, add them as negative labels or filter them out post-extraction (already identified in audit; user confirms they should be excluded from PRODUCT). Evidence: audit (`docs/model-audit-2026-09-27.md`) shows these are false-positive product flags; user's instruction confirms.
6. **Manual review / feedback loop** — docs reference `ITextExtractionTestResultFeedbackDto` (manual feedback DTO). This confirms the pipeline supports manual correction. For this feature: allow manual review of extractions (through an admin/logs interface or direct DB edit of `extractions` table) to build a domain-corrected gold set — consistent with the audit's recommendation (#8: rubric alignment before retraining) and the docs' manual feedback mechanism.

What this is NOT (clear scope boundary):
- Not a full retrain of GLiNER on a new large dataset — the user's instruction is to restrict extractions to relevant terms, which is a configuration/change in labels + filtering, not a new fine-tune pass. Retraining is deferred (per audit recommendation order; retrain only after dataset quality fixes).
- Not a new LLM/narrative feature — the user explicitly said "strictly. Nothing more." This is a filter/config change.
- Not a new backend endpoint — reuse existing `/api/trends?metric=entity` and the `extractions` table; no new route needed.

Evidence artifacts:
- `docs/model-audit-2026-09-27.md` (local, measured 2026-09-27): PERSON 97%, EMAIL 100%, PRODUCT 72%, gold PERSON spans include '@' convention, debatable HIGH labels identified.
- `docs/prediction-extraction-improvement-research-2026-09-27.md` (local): recommends evaluation fix (#1) and class-weight fix (#2) before retraining; confirms product recall is data-coverage issue.
- `app/exports/training_ner_v2.csv` (local): PERSON includes '@' convention; gold dataset clean (0 bad offsets, 0 overlaps).
- `ml/gliner/checkpoints/forum-v2/` (local): fine-tune completed; checkpoint files present; macro F1 89.6%.
- `ml/gliner_finetune.log` (local): PERSON F1 97%, EMAIL 100%, PRODUCT 72%.
- MCP `search_docs` results (live 2026-09-27): confirmed AI Hub docs have `TextExtractionService`, `Document Extraction Model`, `ITextExtractionTestResultFeedbackDto`, `SDK Docs`, architecture with Reels/Workbench/SSD, `pulse-publication`.
- Web extract `https://documentation.neutrinos.com/article/ai-hub/overview` (live): AI Hub framework description; REST APIs; SDK; use cases include NLP/text analysis; confirms the pipeline's purpose matches this feature.
- Web search results: `BrandNERD` (domain brand NER with canonicalization + similarity clustering); `GLiNER` paper (`2311.08526`); `knowledge-platform-ner`; `GLiNER2` docs (threshold/description/relations); `unipd` thesis (sequential GLiNER strategy for contract extraction, applicable to domain filtering).

File references for implementation (verified in workspace):
- `app/backend/app/routes/trends.py` — current trend endpoint (entity packing lowercase label; needs uppercase or normalization fix).
- `app/frontend/src/pages/MetricsExplorer.jsx` — current metrics page (entity card empty due to regex mismatch; fix by aligning case).
- `app/frontend/src/components/charts/EntityBar.jsx` — entity chart renderer.
- `ml/pipeline/inference_server.py` — GLiNER inference server (label array definition).
- `ml/gliner/` — GLiNER fine-tune directory; `ml/gliner_finetune.log` — measured scores.
- `app/exports/training_ner_v2.csv` — clean gold dataset (2,573 spans: PERSON 1,652, PRODUCT 758, EMAIL 163).
- `docs/model-audit-2026-09-27.md`, `docs/prediction-extraction-improvement-research-2026-09-27.md` — audit/research reports with evidence.

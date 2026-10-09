# Documentation index

What each doc is, and whether it describes the current system or is a dated record.

## Current reference

| Doc | What it covers |
|-----|----------------|
| [`../README.md`](../README.md) | Project overview, architecture, quick start |
| [`../app/README.md`](../app/README.md) | Stack runbook: ports, env vars, sidecar setup, validation |
| [`observability-plan.md`](observability-plan.md) | Logging/metrics design (Loki + Prometheus) |
| [`production-audit-2026-09-28.md`](production-audit-2026-09-28.md) | Production-readiness audit of the live stack |

## Implementation history

| Doc | What it covers |
|-----|----------------|
| [`implementation-plan.md`](implementation-plan.md) | The v2 plan the system was built against (see its header — the AI Hub direction was replaced by the local sidecar + GLM) |
| [`implementation-plan-audit.md`](implementation-plan-audit.md) | Audit of the plan against the AI Hub REST contract |

## Model & data records (dated)

Kept for provenance. Numbers are as measured on their date; training data and one-off
training scripts referenced here are regenerated from the database and are not committed.

| Doc | What it covers |
|-----|----------------|
| [`model-audit-2026-09-27.md`](model-audit-2026-09-27.md) | Laya + GLiNER quality audit (measured) |
| [`ner-research-neutrinos-products-2026-09-27.md`](ner-research-neutrinos-products-2026-09-27.md) | NER vocabulary research |
| [`prediction-extraction-improvement-research-2026-09-27.md`](prediction-extraction-improvement-research-2026-09-27.md) | Prediction/extraction improvement research |
| [`laya-product-context-experiment-2026-09-28.md`](laya-product-context-experiment-2026-09-28.md) | Laya product-context fine-tune experiment |
| [`label-cleanup-2026-09-27.md`](label-cleanup-2026-09-27.md) | Priority label cleanup pass |
| [`label-cleanup-sentiment-20260927.md`](label-cleanup-sentiment-20260927.md) | Sentiment rubric audit |
| [`training-rubric-2026-09-17.md`](training-rubric-2026-09-17.md) | Priority/sentiment labelling rubric |
| [`go-live-2026-09-27.md`](go-live-2026-09-27.md) | Go-live record |

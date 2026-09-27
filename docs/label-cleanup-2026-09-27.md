# Label Cleanup Pass (2026-09-27)

Scope: resolve the 3 outstanding AMBIGUOUS-KEPT rows in
`relabel_review_priority.csv` and fix the 3 mislabeled holdout rows
identified in `docs/model-audit-2026-09-27.md` §3 ("the 10 missed high
posts, actually read"). Applied via `ml/scripts/label_cleanup_20260927.py`
against the training rubric (`docs/training-rubric-2026-09-17.md`). Backups
of every touched file: `docs/label-cleanup-backup-20260927/`.

## AMBIGUOUS-KEPT rows resolved (relabel_review_priority.csv)

| # | Text (truncated) | Was | Decision | Reason |
|---|---|---|---|---|
| 1 | "High-Net-Worth (HNW) underwriting is often delayed..." (translation-pipeline case study) | high | **low** | Customer case study / marketing — no reader action required. Rubric explicitly excludes case studies from high. |
| 2 | "Release [code]... This release changes the runtime contract... reCAPTCHA... flagged CRITICAL/HIGH by the image scan" | high | **high (confirmed)** | Breaking runtime-contract change + a CRITICAL/HIGH security-scan finding being remediated = rubric family 4 ("releases with teeth"). Legitimately high. |
| 3 | "POC using Neutrinos Reels... Master Data status stuck Processing... blank page... multiple people hitting same issue today" | high | **high (confirmed)** | Framed as a POC but the author is blocked and says so, with other users independently hitting the same wall = rubric family 1 (blocked work), not a POC showcase. |

Only row 1 changed data; it was seed-variant augmented during the original
rebalance, so the label flip applied to **5 rows** (1 original + 4 variants)
across `app/exports/training_priority.csv`, `ml/data_split/pool_priority.csv`,
`ml/data_split/rebalance_pool/exports/training_priority.csv`,
`training_priority_rebalanced.csv`, and `ml/data_split/train_priority_final.csv`.

## Holdout mislabels fixed (ml/data_split/holdout_priority.csv)

| Text (truncated) | Was | Now | Reason |
|---|---|---|---|
| "...we want to share how we handle security vulnerabilities and CVEs... Standard Practice..." | high | **medium** | Informational post about their own vuln-handling *process* — no specific vulnerability disclosed, no reader action. Not a security advisory (rubric family 2 requires an actual vuln/CVE/advisory). |
| "The Intelligent Document Processing (IDP) market is projected to grow from $2.3B to $12.35B..." | high | **low** | Market-size stat / industry-trend announcement — rubric's own excluded example ("market projections"). |
| "Avoid sequential calls for master data in pages... write custom code that fires these requests in parallel..." | high | **medium** | Rubric's *literal, named example* of guide/tip material demoted to medium ("tips ('avoid sequential calls')"). |

These 3 were 3 of the "10 missed high" cases counted against the deployed
priority model in the 2026-09-27 audit — they were label errors, not model
failures. True holdout high-recall is therefore better than the reported
50% (10/20); re-run the audit's holdout eval after any retrain to get the
corrected number.

## What this does NOT do yet

These are **data fixes only**. The currently deployed Laya priority
checkpoint (`insights-v1`) was trained before this cleanup and does not
reflect it. A retrain (Add New Data with the corrected CSVs, same recipe as
`docs/training-rubric-2026-09-17.md`) is a separate, larger step — not run
in this pass. Flagging so the "high" label in production isn't assumed to
already include these fixes.

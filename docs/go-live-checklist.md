# Go-live checklist — what you do in AI Hub, and what I need back

Everything in the code is done and verified in stub mode. The remaining work is
in the AI Hub UI, because the platform has no API for model training, Review Hub
rule configuration, retraining, or knowledge-source upload.

**Order matters and changed from the previous version of this file**: AI Hub
will not let you run a Batch/Single test or create a token against an
undeployed model ("the model must be deployed to the selected environment
before you can proceed" / "Tokens can only be generated for models that have
already been deployed" — [Validate Text Models](https://documentation.neutrinos.com/articles/ai-hub/validate-text-models),
[Tokens](https://documentation.neutrinos.com/articles/ai-hub/tokens)). So
**deploy right after training, before you validate or make tokens.**

Work through the steps in order. At the end there is a single block of values
to paste back to me.

---

## Step 1 — Train the three models

> **UPDATE 2026-09-17 — USE THE REBALANCED FILES.** Do NOT train priority/sentiment on the
> originals below; the first training showed why (high recall = 0, pos accuracy 44%). The rubric
> scrub + rebalance is done: `docs/training-rubric-2026-09-17.md` explains what changed and why.
>
> | Model | Upload this | Batch-test against |
> |---|---|---|
> | Priority classifier | `training_priority_rebalanced.csv` (2,208 rows, high 12.0%) | `batchtest_priority_real.csv` (real rows only, zero synthetic) |
> | Sentiment classifier | `training_sentiment_rebalanced.csv` (2,230 rows, pos 19.0%) | `batchtest_sentiment_real.csv` (real rows only, zero synthetic) |
> | NER extraction | `training_ner_v2.csv` (unchanged — dataset audited clean) | — |
>
> Label column in the new files is `label` (text column is still `text`). Every relabel is
> logged in `relabel_review_priority.csv` / `relabel_review_sentiment.csv` for audit.

Training data is already exported and waiting in `app/exports/`:

| File | Model | AI Hub type |
|------|-------|-------------|
| `training_priority.csv` | Priority classifier | [Prediction → Text](https://documentation.neutrinos.com/articles/ai-hub/text-prediction-model) |
| `training_sentiment.csv` | Sentiment classifier | [Prediction → Text](https://documentation.neutrinos.com/articles/ai-hub/text-prediction-model) |
| `training_ner_v2.csv` (see `NER_v2_README.md`) | Entity extraction | [Extraction → Text](https://documentation.neutrinos.com/articles/ai-hub/text-extraction-model) |

For each: **Prediction** (or **Extraction**) → **Text** tab → **Add** → upload the
CSV → pick the text column and the label column → name the model.

**While still in the creation wizard**, you'll hit a step called **"Define the
rules"** — this is the Review Hub feedback-loop rule, and it's set here, not
later. Pick one of:

- **Always** — every prediction goes to your Review Hub queue.
- **Never** — nothing goes to Review Hub.
- **Confident** — only predictions below a confidence threshold you set (0.75
  is a sensible start) go to Review Hub. **This is the one we want.**

For the **NER extraction model only**, this rule is set **per entity**
(PERSON / PRODUCT / EMAIL each get their own Always/Never/Confident choice) —
set all three to Confident/0.75 unless you want different thresholds per
entity type.

(You can change this later too, per model version, under that version's
**Rules** tab → Save — no need to retrain to adjust the threshold.)

**⚠️ Extraction (NER) needs manual tagging before it will train — Prediction
does not.** After the rules step, the platform shows you the uploaded text on
the left and your three entity identifiers (PERSON/PRODUCT/EMAIL) on the
right. Click an identifier, then click the matching text on the left to tag
it — repeat for **at least 25 tagged examples** across the file. The **Start
Training** button only appears once you hit 25. This is manual, one-by-one
work; budget 20–30 minutes for it. (Priority/Sentiment skip this — if your
CSV already has a label column, category confirmation there is optional.)

**⚠️ The exact label strings matter.** The backend maps AI Hub's returned
category name onto our enum. Right now it accepts `high` / `medium` / `med` /
`low` / `p1` / `p2` / `p3` for priority, and `pos` / `positive` / `neu` /
`neutral` / `neg` / `negative` for sentiment. If you train with anything else
("High Priority", "Critical", "😀"), tell me the exact strings and I will
extend the mapping — otherwise every prediction is rejected with a clear error
rather than silently mis-filed.

## Step 2 — Deploy each model

Do this *before* validating or making tokens — both of the next two steps
require it.

[Deployment](https://documentation.neutrinos.com/articles/ai-hub/deployment) →
pick **Sandbox** → **Add** → name it, paste the license key (contact
`subscription@neutrinos.com` if you don't have one) → **Submit**. Then, on
each model's version page, kebab menu (⋮) → select **Sandbox** → enable
**Deploy to Sandbox** → pick the deployment unit you just made → **Submit**.

## Step 3 — Validate each model

Now that it's deployed: on the model version page, left panel → **Test** →
**Batch** tab → **Add** → select the Sandbox environment → upload a CSV that
includes a **Ground Truth** column (a sample template is downloadable there) →
**Start Testing**.

The plan's gate is **≥90% F1 on the High class** before priority scores are
shown to leadership without a "provisional" label. Send me the
Accuracy/Precision/Recall/F1 numbers it reports and I will record them on the
`model_versions` row.

## Step 4 — Day-to-day: the Review Hub queue

This is the accuracy loop, running on the "Confident" rule you set in Step 1.
Your ~15 min/day is: **Review Hub → Pending →** Confirm / Skip / Ignore. The
backend polls the results it stored and pulls your verdicts back into
`review_feedback` automatically; corrections also update the local prediction.
([Review Hub — Text Model](https://documentation.neutrinos.com/articles/ai-hub/review-hub-text-model))

## Step 5 — Create the Analyst assistant

Follow `docs/aihub-assistant-setup.md` for the directive text and guardrails.
Two things that differ from that document now:

- **Do not** plan on a knowledge source holding the rolling analysis data. The
  API is read-only for knowledge sources ([Toolsets — Set Knowledge
  Source](https://documentation.neutrinos.com/articles/ai-hub/toolsets)), so
  the nightly cycle sends the current analysis extract inline in the message
  instead. Map knowledge sources only for static reference material (product
  glossary, module list) — I auto-discover whatever is mapped
  (`assistant/knowledge/find-all`).
- **Do not** configure the API Connector yet. It needs AI Hub to reach this
  machine, which it cannot while we run on localhost. The nightly cycle pulls
  the insights instead and runs them through the identical validation gate. We
  switch the connector on when the stack is hosted.

In the assistant's **Instruction** panel, set **Output format** to **JSON**
(default is Raw text) and define the JSON schema there, then deploy the
assistant the same way as Step 2.

## Step 6 — Create four tokens

**Tokens → Sandbox → Add.** One per *deployed* model, **Expiry: Never** (the
pipeline is unattended; 30 min / 3 h tokens will break it overnight).
([Tokens](https://documentation.neutrinos.com/articles/ai-hub/tokens))

| Token | Training Type | Data Type | Model |
|-------|---------------|-----------|-------|
| NER | Extraction | Text | your extraction model + version |
| Priority | Prediction | Text | your priority model + version |
| Sentiment | Prediction | Text | your sentiment model + version |
| Assistant | Assistant | — | Community Insights Analyst + version |

**The token value is shown once.** Copy it before clicking OK.

## Step 7 — Copy two cURLs

On the **Integrations** page of *one* Prediction model and *one* Extraction
model, select your version + Sandbox + the **Predict Text** / single-test API
and copy the cURL.
([Integrate APIs — Text Prediction](https://documentation.neutrinos.com/articles/ai-hub/integrate-apis-text-prediction))

This is the one thing I cannot verify from the docs alone: whether your
trained models take `{"text": "..."}` or `{"input": {"<column name>": "..."}}`,
and whether your sandbox uses exactly the documented paths. Paste both cURLs
to me **with the token redacted** and I will confirm or adjust in one line of
config.

---

## What to send me

```
1. Priority label strings (exact):        ______ / ______ / ______
2. Sentiment label strings (exact):       ______ / ______ / ______
3. Batch validation metrics per model:    accuracy / precision / recall / F1
4. AIHUB_TOKEN_PRIORITY=
5. AIHUB_TOKEN_SENTIMENT=
6. AIHUB_TOKEN_NER=
7. AIHUB_ASSISTANT_TOKEN=
8. AIHUB_BASE_URL=                        (confirm https://aihub-staging.neutrinos.com)
9. The two cURLs from Step 7 (token redacted)
10. Optional, for traceability only:
    AIHUB_PRIORITY_DEPLOYMENT_ID=
    AIHUB_SENTIMENT_DEPLOYMENT_ID=
    AIHUB_NER_DEPLOYMENT_ID=
    AIHUB_ASSISTANT_ID=
```

Put the tokens straight into `app/.env` rather than pasting them in chat if you
prefer — just tell me they are in and I will read the file. `app/.env` is
gitignored, and the repo is not a git repository yet.

---

## Decision A — Discourse backfill: DONE, in progress

Cursor was cleared and the full backfill is running now (job `ingest`,
queued as `job_queue` id 51). It walks every reachable topic from
`/latest.json` (~1250 of the forum's 1271 — the ~21 gap is category-definition
topics Discourse itself excludes from listings) and every post in each,
throttled and `Retry-After`-aware. I'll report the final topic/post counts
against the forum's ground truth (`topics_count=1271`, `posts_count=6191` from
`/about.json`) once it finishes.

## Decision B still needed from you

**Analyse the whole corpus on day one, or only new posts?**
2082+ posts × 3 models ≈ 6,250+ AI Hub calls for a full re-analysis with real
models (more once the backfill lands the rest of the forum). At
`AIHUB_CONCURRENCY=4` that is roughly 15–30+ minutes and, more importantly,
whatever your sandbox quota charges for it. Options:

- **New posts only** (default): existing stub results stay, real models apply
  going forward. Cheapest, but the dashboard mixes `stub-1` and real results.
- **Full re-analysis**: I clear the analysis markers and everything is
  re-processed once with the real models. Clean data, one bounded cost.

---

## After you send the values

I will:

1. Put the tokens in `app/.env` and restart the two services.
2. Run one post through each model end to end and show you the raw AI Hub
   response next to the row it produced — so we confirm the contract on real
   traffic before turning the scheduler loose.
3. Record each model version and its Step-3 metrics in `model_versions`.
4. Run whichever re-analysis you chose in Decision B.
5. Trigger one assistant cycle and show you the insights it produced, the ones
   the evidence gate rejected, and why.

## Still open, not blocking you

- `Admin.jsx` is styled with Tailwind colour classes that do not exist in the
  brand theme (`bg-surface`, `text-primary`, …), so the page renders close to
  invisible, and it is dark-themed against the light-only brand rule. Needs a
  rewrite in the brand system — say when.
- No retention job (`§5`: "raw analysis rows kept 18 months").
- 23 one-shot `patch_*.py` scripts in the repo root, and `video.mp4` (7.3 GB).
  Safe to delete — I have not touched them.
- The repo is still not a git repository.

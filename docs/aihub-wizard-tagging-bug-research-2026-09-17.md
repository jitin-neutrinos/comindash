# AI Hub Extraction Wizard — Confirm/Skip grayed out after ~25–27 tags (research, 2026-09-17)

Symptom: in the Text Extraction Model creation wizard's click-tagging step, after roughly 25–27
manual tags the Confirm/Save and Skip buttons gray out and nothing happens. Documented platform
rule: a minimum of 25 completed extractions makes the Start Training button appear.

Research: Neutrinos AI Hub official docs (verification quotes below) + GitHub/issue-tracker
precedents from Label Studio, Argo Workflows, JupyterLab-Git, GitHub Writer, doccano.
Full ranked findings; likelihood assigned by evidence strength.

## Verified from the official docs

- Tagging rule (verbatim): "Repeat the above two steps to perform a minimum of 25 extractions
  required to train the model. Once 25 entries are completed, the **Start Training button will
  appear at the bottom of the page**." — https://documentation.neutrinos.com/article/ai-hub/text-extraction-model
- The docs document **no maximum tag limit, no per-page limit for the tagging grid, and no
  mid-wizard save/auto-save behavior** — silence on grayed-out Confirm/Skip.
- The Tokens page confirms the platform issues short-lived credentials ("Expiry: 30 minutes,
  3 hours, or Never") — documented for API tokens; UI session length is undocumented, so applying
  it to the wizard is inference. The same page shows AI Hub tables paginate at 10 rows default,
  30 viewable — platform grids commonly page around 10–30 rows.

## Ranked causes (most likely first)

| # | Likelihood | Cause | Plain-language action | Source |
|---|---|---|---|---|
| 1 | **High** | **Wizard gating — you're done.** Both Confirm AND Skip graying out together at exactly ~25 is the signature of the wizard reaching its gating state (per-row actions retired), not an input failure. Start Training appears at the bottom of the page. | Scroll to the very bottom of the wizard and look for **Start Training**. If it's there, click it — tagging is finished. If not, complete one more tag pair and check again. | docs: text-extraction-model |
| 2 | **High** | **Dangling tag** — an identifier (PERSON/PRODUCT/EMAIL) is still selected but its matching text was never clicked, leaving an unfinished pair. Annotation tools intentionally disable submit while a tag is incomplete (Label Studio fix BROS-847 does exactly this). Tends to surface after many rapid tag cycles. | Look for an identifier still highlighted/selected, or text highlighted in a "pending" color you didn't finish. Click its matching text to finish the pair, or click the identifier again / press Escape to clear. Buttons come back once nothing is half-done. | github.com/HumanSignal/label-studio/commit/2a9bfbcb |
| 3 | Medium | **Stale front-end state / two tabs open** — same class as Argo Workflows #13892 (submit grayed out with a second tab open; refresh fixed it), jupyterlab-git #639, GitHub Writer #172. Label Studio 1.22.0 shipped a fix for Submit/Skip vanishing from leftover state. | Close other AI Hub tabs, hard-refresh (Ctrl+Shift+R), reopen the wizard. Check your ~25 tags are still shown, then go to Start Training. | github.com/argoproj/argo-workflows/issues/13892 |
| 4 | Medium | **Counting mismatch** — "about 25–27" is a human count; clicks that hit an already-tagged pair, re-selections, or failed registrations don't count. The platform needs 25 *completed* extractions. | Count the actual highlighted tags in the panels (not your clicks). If 24 or fewer, tag a few more — Confirm re-enables and Start Training appears at 25. Extra tags beyond the minimum are harmless. | docs: text-extraction-model |
| 5 | Medium | **Session/credential expiry** — AI Hub credentials default to 30 min / 3 h. Tagging 25+ items by hand easily exceeds 30 minutes. Precedent: Label Studio Enterprise saves the draft but blocks submission after a session/lock expires. | Log out and back in to aihub-staging.neutrinos.com, reopen the model, check tags persisted, click Start Training. Future long tagging sessions: re-login first, finish within 30 min. | docs: tokens (inference for UI) |
| 6 | Low | **Pagination trap** — the grid may load ~25–30 rows per page (platform convention); buttons can disable when the visible page is exhausted. Not confirmed for the wizard in any doc. | Scroll in both panels for page controls, a counter like "1–25 of 100", or a Next arrow; continue on the next page. | docs: tokens (convention) |
| 7 | Low | **Browser extension interference** — ad blocker / privacy shield breaking the wizard's JavaScript (precedent: GitHub Writer #172, Brave shield). Staging domains get over-filtered. | Try once in an Incognito window (extensions off), log in again. If it works, allowlist aihub-staging.neutrinos.com in the ad blocker. | github.com/ckeditor/github-writer/issues/172 |
| 8 | Low | **Unhandled JavaScript error** killed the page's handlers — buttons render but do nothing. Fallback hypothesis; no Neutrinos-specific public bug report exists (closed source). | F12 → Console tab → look for red errors → Ctrl+Shift+R. If it recurs at the same count, screenshot the console errors and report to the AI Hub administrator/support as a product bug. | labelstud.io/guide/troubleshooting |

## Recommended order when it happens again

1. Scroll to the bottom — is **Start Training** there? Click it. (Most likely answer.)
2. Any half-finished highlight? Complete or clear it.
3. Hard refresh (Ctrl+Shift+R), other AI Hub tabs closed; verify tags persisted.
4. Count actual tags — under 25? Add a few more.
5. Still stuck: re-login (30-min window), then incognito, then console errors → support.

## All sources

- https://documentation.neutrinos.com/article/ai-hub/text-extraction-model
- https://documentation.neutrinos.com/article/ai-hub/work-with-text-extraction-models
- https://documentation.neutrinos.com/article/ai-hub/review-hub-text-extraction-model
- https://documentation.neutrinos.com/article/ai-hub/tokens
- https://github.com/HumanSignal/label-studio/commit/2a9bfbcbf0a844b999de97e601d16050a893f5fb
- https://labelstud.io/guide/troubleshooting (+ Label Studio 1.22.0 release notes)
- https://github.com/argoproj/argo-workflows/issues/13892
- https://github.com/jupyterlab/jupyterlab-git/issues/639
- https://github.com/ckeditor/github-writer/issues/172
- https://github.com/doccano/doccano/issues/1831

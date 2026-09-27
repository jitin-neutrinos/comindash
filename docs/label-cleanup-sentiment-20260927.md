# Sentiment rubric audit — 2026-09-27 (manual pass for fix #3)

Evidence source: `ml/data_split/holdout_sentiment.csv` + audit notes from 2026-09-27 session.

Holdout: 363 rows (read via stdlib csv). Class distribution (observed): pos ~35, neu ~261, neg ~67.
Positive misses (confusion): 11/35. Breakdown:
  - pos → neu: 9/11 (82%) — these are genuinely ambiguous at sentence-level. Examples:
    * Row 51: "It is resolved I think" — resolution + hedging → could be mild-pos or neutral.
    * Row 331: tutorial/help post with "Thanks!" embedded but primarily informational.
    * Row 327: leaderboard announcement — positive in tone, informational in purpose.
    * Marketing/announcement rows (329, 333, 336, 345): genuinely positive but not complaint-resolution.
  - pos → neg: 2/11 — likely annotation errors (one contains negative context + positive closing).

Rubric refinement proposal (per external sources: Koppel & Schler sentiment; PLOS ONE 2020 schema):
  Add finer scale at annotation: strong-pos / mild-pos / neutral / mild-neg / strong-neg.
  Collapse to 3 classes at train time; explicitly label ambiguous cases as mild-pos/mild-neg,
  then optionally exclude "mild" rows from training (or assign them to nearest polar based
  on intensity threshold). This raises the ceiling the other fixes can't touch.

Status: MANUAL PASS DOCUMENTED. Annotation pass NOT started (requires user decision
on whether to invest in 5-class relabeling of the full 2,230-row training set).

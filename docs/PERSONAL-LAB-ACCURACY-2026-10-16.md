# Personal Lab accuracy and usability review — 2026-10-16

Fixed reproducible aggregation errors:

- A recurring entry-distance finding could combine different asset types and recorded setups. It now uses an exact asset/setup cohort, with its own denominator and a visible cohort label. Missing setup has a separate unknown cohort.
- Recorded pullback/reversal/other non-breakout setups no longer contribute to recurring breakout-distance findings. Their individual price analysis remains available and is not classified as a verified mistake.
- Multiple rows for the same symbol and entry date could inflate repetition. They now count as one observation; conflicting setup or distance values exclude that day from the recurring sample. Existing journal records are not edited or deleted.
- Equal-count findings and their examples depended on asynchronous market-history completion order. Selection and example ordering are now deterministic.

Verification: 295 logic tests and 55 browser tests passed. New logic regressions reproduce cohort mixing, duplicated entry days, conflicting same-day values and completion-order dependence before the fixes. Existing browser coverage includes compactness, evidence links, privacy, themes, keyboard and account resets. A synthetic preview screenshot is saved in docs/personal-lab-accuracy-review.png.

Limits: the automatic check still compares entry with a prior 20-bar high, not a user-confirmed pivot. It does not verify full VCP, intraday entry conditions or a personal rule. Four trades are initially reviewed; visible coverage remains partial until expanded. No empirical classifier accuracy, causal relationship or legal compliance is established by passing software tests. No private live trade data was used. Release requested by the user; deployment status is verified separately in the task.

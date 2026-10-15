# Personal Lab QA — 2026-10-14

## Scope

Checked the implemented 30-day experiment workflow and its integration with the journal. Automatic verification of a user's personal entry rules, strategy-definition forms and recurring-rule violations are not implemented yet and are not covered as working features by this report. Current setup/reason metrics measure documentation completeness only.

## Fixes

1. A synchronous SDK error could access an uninitialized promise and leave loading unrecoverable. The loader now starts in a scheduled promise callback; regression reproduced the error before the fix and passes afterward.
2. A concurrent caller asking for history could silently retry a failed shared request, hiding the error. Failed shared loads now return failure consistently and keep retry under user control. Account identity is checked again before queued follow-up work.
3. A new experiment could inherit the previous experiment's selected conclusion. New experiment identities reset that choice to no conclusion; normal refresh of the same experiment retains unfinished notes and the selected choice.
4. Documentation-only metrics now say “Documentation completeness” / “שלמות התיעוד” rather than suggesting automatic verification of personal trading rules. Empty periods explicitly say there are no records to measure.

## Additional browser coverage

The recovery test waits for initial loading to finish before injecting failures. This avoids confusing an unrelated startup request with the controlled failed request. It exercises a synchronous load failure, manual retry, note/choice preservation on refresh, PT409 from another device, data reload and successful retry using the new server timestamp.

Existing browser coverage checks create/save failure/retry, reload persistence, account changes, frozen summary, edits updating active metrics, Hebrew/English, light/dark, desktop/tablet, keyboard accessibility, contrast and privacy mode. All test accounts and trades are fixtures.

## Validation

- Logic: 261 passed.
- Edge: 67 passed.
- SQL: ownership, lifecycle, financial fixtures, immutable snapshots and normalization checks passed in rollback-only transactions with dedicated fake accounts.
- Full browser suite: final run in progress when this report was created; see appended result.
- No new schema mutations, live trade writes, frontend publication or git push in this QA pass.

## Remaining product work

The agreed next direction requires versioned personal setup/rule definitions and reliable original entry evidence before automatic evaluation can be claimed. Existing imported date-only records cannot prove intraday conditions or reconstruct an original mutable stop. Missing evidence must remain unknown, not a violation or a pass. This is separate from the functioning experiment/documentation workflow.

Final browser result: 38 passed, 0 failed. Includes the new retry/conflict recovery scenario. Full logic suite: 261 passed, 0 failed. No test validation remains blocked for the implemented experiment workflow.

## Entry-pattern hint and documentation action follow-up

Latest validation: 264 logic tests and all 41 browser tests passed (including contrast and keyboard suites). The documentation action opens the missing field directly with an explanation, cleans that explanation on close and normal editing, and handles setup and entry-reason experiments. The automatic chart shows a separate heuristic base-breakout hint. Tests demonstrate exclusion of entry-day/future bars, insufficient/stale history, unsupported shorts, explanatory UI, explicit confirmation, preservation of an existing setup and rejection of obsolete view actions. Existing stock/crypto chart and account-boundary browser tests remain green. The synthetic local preview is available at `?mode=active&view=setup`; screenshot: `docs/personal-lab-setup-hint.png`.

This is not VCP recognition or personal-rule compliance checking. No live trading account was used and no frontend deployment was performed in this follow-up.

## Accuracy hardening follow-up

Found and reproduced: silently dropping corrupt recent OHLC records could manufacture a valid window; uninterrupted rising prices could be labelled a base; setup confirmation could erase imported ECN fees and unchanged custom entry reasons; permanently cached market history could become stale; a cached image could acquire an explanation from a different market snapshot. Each failure was reproduced by a failing regression before its fix.

Fresh results: 268 logic tests passed. The full browser/accessibility run passed all 42 tests it collected. After the final image-cache correction, all four targeted chart/confirmation/cache browser tests passed, including the newly added snapshot-consistency case. Both changed production scripts passed Node syntax checks. No SQL or Edge changes, live trade writes, push or deployment were performed.

Method `base-breakout-v2` now validates the actual recent window, rejects repeated/faulty feeds, checks basic base structure, preserves documented setup choices and explains unknown/non-match reasons. Synthetic tests cover sorting, input immutability and independence from subsequent outcomes. No empirical accuracy percentage or VCP/personal-rule verification is claimed; that requires independent, manually labelled historical examples and reliable entry-time evidence.

## Full recheck after all hardening changes

The final, unchanged implementation was rerun: **268 logic tests and all 43 browser/accessibility tests passed**, zero failures or skips. The full browser run now includes the image/explanation cache-consistency regression as well as fee preservation, setup confirmation, stock/crypto images, account isolation, retries, keyboard navigation and contrast. Node syntax checks and `git diff --check` passed. The open local preview was also visually inspected. No additional product fixes were required in this recheck. All account/data tests used mocks; this is not a live broker-account verification or an empirical accuracy measurement. No deployment was performed.

## Automatic workflow moved into Statistics > Personal Lab

Implemented the user's location/workflow correction: automatic setup analysis and the existing generated trade chart now appear first in the lab. Manual setup entry and opening the camera modal are not prerequisites. Habit experiments remain optional below the analysis. Analysis uses raw pre-entry OHLC data and retains the existing limited base-breakout method; full VCP/personal-rule recognition is not claimed.

Validation: 268 logic tests passed; the full browser run passed all 44 collected tests, including the new automatic-lab workflow. After the final result-first layout change, both targeted lab workflow/account-switch tests passed. The latter additionally verifies only two quote requests start concurrently and that delayed responses cannot continue loading for a replaced account. The synthetic preview was visually inspected in the user's browser; screenshot `docs/personal-lab-automatic-analysis.png`. No production deployment or live trading writes occurred.

## Usability and progressive-disclosure pass

Applied impeccable product/distill guidance against the existing PRODUCT/DESIGN context. Removed the repeated expanded charts and nested bordered explanation panels from the initial view. Each trade now presents its status and short explanation; chart and optional documentation use labelled native details. Charts are generated only on opening, so the default four summaries build zero images. Chart open state survives rerenders, full-size enlargement remains available, and Show more now focuses the first newly added heading instead of dropping keyboard focus to the body.

Fresh verification: **268 logic tests and all 46 collected browser/accessibility tests passed**. Additional focused compactness and chart-failure/retry tests both passed. The tests verify summary height under 340px in the representative desktop fixture, no initial chart generation, 1280/1024/768px overflow checks, dark/light contrast and labels, keyboard disclosure operation, privacy blur and chart-open preservation. A failed chart retains the readable analysis and offers an in-place retry. Source syntax checks and diff whitespace checks passed. Screenshot: `docs/personal-lab-ux-compact.png`. Tests use synthetic data; no live-account or empirical pattern-accuracy certification is implied. Frontend changes remain local.

Final user-requested recheck: the unchanged implementation passed **268 logic tests and the full 47-test browser/accessibility suite**, zero failures and skips. All three affected production scripts passed Node syntax checks; diff whitespace checks passed. No additional fixes or deployment were required. Browser coverage includes the chart-failure/retry test in the full run, automatic lab analysis, cache consistency, fee preservation, delayed account changes, compactness, contrast and keyboard navigation. All account boundaries used mocked users and trades.

## Lab button entry

User requested a single lab button in Statistics before showing the feature. Implemented a closed-by-default native disclosure with translated label, 44px minimum target and focus styling. Opening loads lab history/analysis; closing invalidates automatic analysis work. Account reset closes it; the overview link explicitly opens the same disclosure. Existing lab tests now open the actual entry control rather than relying on an always-expanded lab.

Verification: **268 logic tests and all 48 browser/accessibility tests passed**, with no failures or skips. The new entry test verifies closed/default state, no automatic classification while closed, keyboard opening, closing and account reset. Syntax and whitespace checks passed. Open/close was also verified in the user's local preview. Screenshot: `docs/personal-lab-launch-button.png`. No deployment or live trading writes occurred.

## Conclusions and recurring-observation audit

Found a product validity gap: separate per-trade setup hints did not establish repeated mistakes. Added a scoped, live recurring-observation summary with reviewed/total coverage, unknown counts, partial-review wording, distinct trade counting, a minimum of two examples, explicit comparable-example denominators and traceable example buttons. Non-matches and losses are never called verified mistakes; the fixed 3% method threshold is explicitly not a user-defined rule. No-pattern wording does not certify absence of mistakes. Summary state is cleared on account reset, and stale work remains guarded.

Also reproduced and fixed a numerical boundary bug: an exact 3% entry distance could compare as above 3% due to binary floating point. Percentage normalization is covered at stock and small-crypto scales.

Fresh validation: **271 logic tests and all 49 browser/accessibility tests passed**, zero failures or skips. Added behavioral cases for duplicate/unknown exclusion, one-example insufficiency, partial coverage, example navigation, account clearing and exact threshold arithmetic. Source syntax/diff checks passed. The user's synthetic preview was inspected with the recurring-observation details expanded; screenshot `docs/personal-lab-observations.png`.

Supported conclusions are descriptive observations from the reviewed input records and market bars. Verified personal-rule violations, full VCP recognition, original-entry-time reconstruction, causal P&L claims and empirical classifier accuracy remain unsupported. No live trading accounts, deployment or database writes were used in this audit.

## Comprehensive simplification and robustness audit

Removed duplicate coverage counters, collapsed the optional habit experiments while preserving their data and explicit overview entry path, and preserved the recurring-summary disclosure across refreshes. Corrected the comparable-distance denominator: a shape non-match with a measurable distance must not silently disappear from that denominator. The displayed label now explains which subset is being counted. Added a 15-second abort deadline to shared market-history requests, with timer cleanup and retryable failure, to prevent indefinite analysis loading on a stalled fetch.

Verification: **273 logic tests and all 49 browser/accessibility tests passed**, zero failures/skips. Regression coverage includes denominator inclusion, request abort/retry, default-folded optional experiments, summary-open persistence, experiment creation/reload, examples, and the previously covered account/privacy/keyboard paths. Source syntax checks and diff whitespace checks passed. The synthetic preview confirmed one coverage region and closed optional experiments; screenshot `docs/personal-lab-comprehensive-review.png`. No data deletion, new schema, deployment or live trading writes occurred. Classifier accuracy and verified personal-rule compliance remain outside this software-validation result.

Entry evidence and personal outcome comparison follow-up: 276 logic tests passed; four focused browser tests passed (camera snapshots, automatic review, personal comparison with five winners/five losers and example focus, recurring-summary account reset). Screenshot: docs/personal-lab-entry-evidence.png. Local mock validation only; no classifier accuracy claim or live deployment.

Simple UI follow-up: 276 logic checks and three focused browser checks passed. Browser check verifies evidence is initially hidden, compact card text is under 200 characters, Why reveals the evidence, and cohort example links remain usable. Screenshot: docs/personal-lab-simple.png.

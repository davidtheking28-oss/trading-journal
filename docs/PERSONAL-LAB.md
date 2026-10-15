# Personal Lab

The personal lab is a 30-day, single-active-experiment workflow. It appears inside Statistics, with a small Overview card. Templates measure daily trade-record limits, setup documentation or entry-reason documentation. It never places or blocks broker orders and does not promise returns.

## Code boundaries

- `assets/js/personal-lab.js` owns templates, strict calendar-date cohorts, live calculations, account-safe state, UI and lifecycle RPC calls. `loadPersonalLabFeature` loads it via the existing shared lazy loader.
- `dashboard.js` connects the two surfaces, journal changes, existing realtime channel and page visibility. Auth/sign-out invalidate pending lab work before another account renders.
- `sw.js` precaches the module; `tests/harness.mjs` includes its source.
- Experiment configuration is immutable after start. Mutations use the original identity and server `updated_at`; PT409 requires reloading. Only acknowledged receipts change saved state.

## Server

`personal_experiments` is RLS protected with own-user SELECT only. Public/anonymous callers have no access. Write RPCs are security definer with an empty search path, explicit ownership checks and narrow grants:

- `start_personal_experiment(p_template, p_asset_scope, p_target, p_timezone)` returns the active row. A per-user transaction lock and partial unique index make retry/concurrent start idempotent. Start is tomorrow in the chosen timezone; end is 30 calendar days later.
- `finish_personal_experiment(p_id, p_expected_updated_at, p_choice, p_note)` checks duration/concurrency, calculates its own frozen metrics and returns the completed row.
- `cancel_personal_experiment(p_id, p_expected_updated_at)` retains history and returns the cancelled row.
- `personal_experiment_metrics(p_id)` verifies ownership and returns live metrics or the immutable saved snapshot.

Private cohort helpers are not callable by authenticated/anonymous clients. The parity migration handles supported string-encoded legacy target arrays and ECMAScript whitespace trimming. `auth.users` deletion cascades to experiments; this does not constitute a complete account-deletion product flow.

## Measurement

Current and previous 30-day cohorts use entry dates and selected asset scope, independently of statistics filters. No-activity days do not inflate adherence. Missing/invalid dates and deleted records are excluded. Documentation metrics describe current completeness, not proof of documentation before entry. Late imports and edits update active metrics but never rewrite a saved summary.

Financial results reuse journal realized-result semantics: `isClosed` includes partial exits, and net deducts ECN and commission. It is labeled “Net realized result,” not fully closed position performance. Small-sample thresholds are product display warnings, not significance tests. No inference of causality.

## Local preview

Run `node tests/personal-lab-preview.cjs`, then visit:

- `http://127.0.0.1:4178/?mode=templates`
- `http://127.0.0.1:4178/?mode=active`
- `http://127.0.0.1:4178/?mode=review`

This server binds to loopback, replaces authentication and broker boundaries with fixtures, and blocks off-origin fetch calls. All amounts and accounts in preview are fake. It is a development helper under tests, excluded from production website staging. The preview navigation resets its mock fixture; production persistence is exercised separately by RPC/SQL tests.

## Verification

- `node --test tests/logic.test.mjs` includes `tests/personal-lab.test.mjs`.
- `npm test --prefix tests` includes browser flows, themes/languages/tablet/privacy, account changes and failed-save retry.
- `tests/personal-experiments.sql` runs ownership/lifecycle/snapshot/financial parity checks in rollback-only transactions with dedicated fake users.
- `tests/fixtures/personal-lab-cases.json` pins financial calculation cases, including partial closes and legacy targets.

Schema migrations have been applied to the verified project. The frontend stays on the feature branch until publication is requested. No live trading records were used for acceptance testing.

## UI simplification — 2026-10-14

Applied the impeccable product, distill and polish guidance using existing PRODUCT/DESIGN context and runtime Heebo/theme conventions. The active experiment now prioritizes its current measure and the next documentation action. Comparison/financial data remain available through a native details disclosure. Template selection uses full-width button rows instead of repeated nested cards. Unnecessary decorative elements and side-stripe alerts were removed; form, type and spacing styles reuse the journal's tokens.

Disclosure state is preserved across journal rerenders for the same experiment. The next-action button directly opens the first missing trade, explains the missing field and focuses its setup or entry-reason control. Configuration Back/Edit controls focus the next relevant control. Successful creation focuses the new heading, without adding it to normal Tab order. Touch actions and summaries have 44px minimum targets; reduced motion is respected.

This is refinement of the existing experiment/documentation workflow. It does not add automatic verification of a user's entry rules or infer that a recorded setup was actually followed.

## Entry pattern hint — 2026-10-14

The existing automatic trade-chart modal now shows a separate possible base-breakout hint, derived from raw daily bars rather than image recognition. No model provider, new dependency or database field is added. It uses the 20 preceding daily bars, excludes the entire entry day and later bars, requires recent contiguous history (no gap over seven days; maximum 45 calendar days for the base), and checks a base high/low range of at most 20% and an entry from 0% to 3% above that high. These are fixed exploratory heuristic thresholds, not the user's trading rules, VCP validation or a certified setup definition. Shorts, insufficient history and invalid data produce an explicit cannot-determine state. A non-match does not imply a mistaken trade.

Evidence and limitations appear beside the chart. Choosing to confirm opens the existing trade editor focused on setup; an empty setup may be preselected as breakout, but nothing is persisted until the user saves. An existing setup is preserved. The lab still measures saved documentation, not suggestions. Reuse the existing OHLC cache and chart feature loader; stale account/view callbacks are ignored. Price splits, market-session timestamps and feed adjustment policies still limit inference from daily data. No volume confirmation or original-entry-time personal-rule evidence is claimed.

Local fake-data demonstration: `http://127.0.0.1:4178/?mode=active&view=setup`. Its OHLC feed is synthetic and must not be used as evidence of live feed quality.

### Accuracy hardening (method `base-breakout-v2`)

The 20-bar window is selected before price validation, so a corrupt recent candle cannot be silently replaced with an older valid candle. Duplicate days, impossible OHLC relationships, fewer than four distinct OHLC records, unsupported shorts and adjacent closing-price discontinuities above 35% yield an explicit unknown reason. That discontinuity threshold is a conservative data-quality heuristic, not a split detector. In addition to the range/entry-distance checks, an earlier high in the first ten bars must lie within 2% of the window high, and an intermediate close must have retraced at least 1% below a preceding high. This filters simple uninterrupted advances; it is still not VCP recognition. Input-order and future-outcome invariance are tested. Nothing assigns a probability or claims calibrated classification accuracy.

Market-history cache entries expire five minutes after completion, failed requests remain retryable, and the map is capped at 100 symbols. Cached trade images retain the exact bar snapshot used by their explanation and expire after five minutes, so an old image cannot acquire a new, inconsistent explanation. Confirming a setup through the existing editor preserves imported ECN fees and unchanged custom entry reasons as well as broker IDs.

A measured accuracy claim still requires an independently labelled historical validation set covering genuine bases, trends, failed breakouts, adjusted prices and different asset classes. Synthetic regression tests establish software behavior; they do not measure trading-pattern recognition accuracy. Intraday timing, breakout volume and personal entry rules remain outside this implementation.

## Automatic analysis is now the primary Personal Lab workflow

User correction: analysis belongs in Statistics > Personal Lab and must run without opening the camera modal or manually recording a setup. `labRender` now places an automatic-analysis section before the optional habit experiment. It lists fully closed, non-deleted stock/crypto trades across the journal, newest closing dates first, four at a time with explicit shown/total counts and a Show more control. This view is independent of experiment dates and the statistics filters below it. Open and partially closed positions are outside this completed-trade review.

Each card displays the original recorded setup separately, automatic explanation first, and the existing automatic entry/exit chart. Detection uses raw OHLC bars, not image OCR. No inferred label is written to the trade automatically; editing documentation is optional and uses the existing editor. The same `base-breakout-v2` limits apply: possible breakout detection is implemented; full VCP classification, personal-rule compliance and repeated-rule-error discovery are not implemented.

At most two analysis workers run per render, and quote requests share the existing market cache. A per-user in-memory result/image cache expires after five minutes and caps at 100 entries. Rendering is bound to the original user object, database, trade fingerprint, lab generation, render sequence, visible statistics tab and connected host. Account reset clears results and invalidates all outstanding work. Errors and unavailable data have retry controls. Privacy styling includes the chart and recorded setup. Charts use one column below 1600px to preserve legibility.

### Progressive disclosure and usability refinement

Initial trade summaries display the detected status and short explanation. The chart and optional documentation/limitations use labelled native disclosures instead of four expanded charts and repeated blocks. Price analysis still runs automatically, but image rendering now starts only when a chart is opened. Chart open/closed state survives journal rerenders and is cleared on account reset. The existing full-resolution image and enlarge action are preserved. Show more focuses the first newly revealed trade heading; disclosure summaries retain 44px targets. Tests cover no initial image generation, keyboard opening, refresh preservation, light/dark contrast, privacy masking and overflow at 1280/1024/768px. Synthetic screenshots are in `docs/personal-lab-ux-compact.png`.

### Lab entry button

Statistics initially shows only a labelled native disclosure styled as the “המעבדה” / “The lab” button. Opening it reveals the whole lab and requests its history/analysis; closing invalidates pending automatic render work and prevents further queued analysis requests. The lab remains closed on reload and account reset. The overview entry action opens this same disclosure before navigating to Statistics. Existing per-chart disclosures remain inside. Opening/closing works through native keyboard and screen-reader semantics, with a 44px target and visible focus.

### What conclusions are supported

The automatic lab now aggregates recurring **observations**, not verified trading mistakes. The live summary counts distinct reviewed trade IDs (scoped by asset type), explicitly discloses the number of eligible closed trades in the journal and how many results are unknown, and labels partial coverage when only the current batch was analyzed. Unknown and failed analyses never count as a pass or as evidence for a pattern. A single example never establishes repetition.

Two or more comparable entry-distance observations can expose a review point: entry more than 3% above, or below, the preceding 20-bar high. The denominator is explicitly the number of distance-checkable examples, not the whole journal. Only valid possible-breakout results and valid distance non-matches contribute to that denominator. The 3% boundary is a fixed method threshold, not a user-defined rule. Percent arithmetic is normalized to eight decimal places so exact-boundary entries (including small crypto prices) are not falsely put beyond the threshold by floating-point noise.

Pattern details show up to three traceable example buttons that focus the corresponding trade. The summary does not claim that early/extended entries were mistakes, that a non-match was a bad trade, that no pattern means no mistakes, that a losing trade broke a rule, or that an observation caused P&L. Personal-rule violation detection still needs explicit versioned personal rules and reliable original entry evidence. Empirical setup-recognition accuracy still needs independently labelled examples. The existing documentation-completeness experiment is separate from these observations.

### Comprehensive review refinements

Coverage counts now appear once: the same region shows analysis progress and then the reviewed/total summary. Optional habit experiments are collapsed by default, retain their data and disclosure state, and open explicitly when reached from the overview's experiment action. The pattern-summary disclosure stays open across rerenders and resets with the account.

Distance denominators include narrow-window shape non-matches whenever their distance was measurable, even though the base classifier did not match. Those rows contribute to the denominator without becoming mistakes or repeated-distance observations. The UI explicitly labels this as comparable distance data. Broad-window/unknown results remain outside this comparable subset. Shared OHLC requests have a 15-second abort deadline, clear their timeout on every outcome, and leave failed requests retryable instead of caching an unresolved request indefinitely.

### Personal outcome comparison
The lab compares median entry distance from the prior 20 daily bars' high within the same recorded setup and asset type, for reviewed long trades. At least five net winners and five net losers are required per group (a display guard, not statistical significance). Net outcome uses calcTotal including fees. Unknown/non-comparable data, missing setup and breakeven trades are excluded; duplicate asset/id rows count once. Example links focus a winning and losing trade. Coverage remains limited to reviewed trades; Show more expands it. This is descriptive association, not confirmed VCP, a verified pivot, causality or personal-rule compliance. No data is written by the comparison.

Entry evidence now retains the actual pre-entry 20-bar high and recorded entry price, with a directional distance explanation in Hebrew and English. Wide-window/shape results include their evidence but remain excluded from comparisons when non-comparable. Unknown data never produces invented price evidence. No fixed threshold is represented as the user's or Minervini's rule.

Simplified review cards show one finding by default. Numerical evidence, limitations and optional editing are under the native Why disclosure; chart remains independently collapsed. Header and insufficient-comparison copy are shortened. No data analysis or persistence semantics changed.

User feedback: even the short cards still felt crowded. The interface now removes the duplicate eyebrow/analysis heading, places recorded setup inside Why, folds personal outcome comparison by default, and uses flat separated rows instead of boxed cards. Preserve this quieter hierarchy in future changes.

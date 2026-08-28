# Project: Trading Journal 2.0

## What it is
Personal trading journal web app — multi-user SaaS built on Supabase.

**Stack:**
- Frontend: Single HTML file (`dashboard.html`) — all CSS, HTML, JS
- Backend: Supabase (auth, database, Edge Functions)
- Hosting: GitHub Pages → `https://davidtheking28-oss.github.io/trading-journal/`
- Supabase project ref: `fnklrqxwyeibfptaxewf`

**Repo:** `c:/Users/david/trading-journal/` (local) | `davidtheking28-oss/trading-journal` (GitHub)

---

## Rules

@C:\Users\david\.claude\rules\behavior.md
@C:\Users\david\.claude\rules\code-style.md
@C:\Users\david\.claude\rules\frontend.md
@C:\Users\david\.claude\rules\git-workflow.md
@C:\Users\david\.claude\rules\supabase.md

---

## Tests
`node --test tests/logic.test.mjs` — no build step, no dependencies. Covers the
pure logic (parsing, P&L, dedup rules) by extracting functions out of
`dashboard.html`; see `tests/README.md`. Run it after touching `flexParseXML`,
`calcPL`/`calcTotal`, `_flexImportInner`, `deduplicateDB`, `_dedupeTrades` or
`biParseRows`. For data-level regressions the client tests cannot see, run
`SELECT * FROM data_health_check();` — a nonzero `critical` row means live data
is wrong right now.

Both layers run unattended: the suite is a required job in
`.github/workflows/deploy.yml` (a red test blocks the Pages deploy *and* the
Edge Function deploy), and the `data-health-alert` cron job runs
`data_health_check()` nightly at 03:45 UTC, messaging Telegram only on failure.

**Every fix to a calculation or import bug belongs in that suite**, and the test
must be shown to fail when the fix is reverted.

## Supabase SQL — Use MCP
When SQL needs to run against the Supabase project (migrations, schema changes, data queries), use the `supabase` MCP server directly — **do not tell the user to paste SQL into the SQL Editor manually**.
Use the MCP tool to execute the SQL automatically.

## Knowledge Base
Personal prompts, frameworks, and lessons: `C:\Users\david\.claude\knowledge-base.md`

---

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-11)

The screener runs embedded as an iframe at `#screener-frame` pointing at the
**live** `https://davidtheking28-oss.github.io/stock-screener/` — not a local
copy. Editing the local `stock-screener` repo does nothing here until it's
committed and pushed to that repo specifically (it has no auto-push hook,
unlike this one — push it manually).

- **`_restoreLastTab()`** (called at the end of `_onAuthSuccess`) must keep
  being called on every login/boot. Without it, any full page reload (a
  backgrounded browser tab getting discarded is enough to trigger one) always
  dumps the user back on the Overview tab regardless of which tab — screener,
  statistics, etc. — they were actually on.
  **It reads/writes `tj_active_tab` in `sessionStorage`, not `localStorage`**
  (changed 2026-08-19, on request): closing the app and coming back should land
  on Overview, while a reload of the same tab should not lose your place.
  sessionStorage is the only thing that distinguishes the two. Moving this key
  back to localStorage reintroduces "it always reopens on the last tab"; deleting
  the call reintroduces the regression above. Both have been reported as bugs.
- **The realtime WebSocket teardown on `visibilitychange`** (search
  `_teardownRealtimeSync` near the bottom of the file) must stay. An open
  Supabase Realtime socket keeps the page ineligible for the browser's
  back/forward cache, making real back/forward navigation always cost a full
  reload.
- **`document.getElementById('auth-overlay').style.display = 'flex'`** in
  `initApp()` must stay conditional on a *missing* local session token, not
  unconditional. Showing it unconditionally flashes the login screen on every
  load even for an already-signed-in user, which reads as a full logout.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-13)

- **`flexParseXML`'s fill-consolidation step** (right before the FIFO
  open/close loop, ~line 13522) must stay. IBKR's SMART order router can
  split one order into several `<Trade>` fills across venues, each with its
  own `tradeID`, landing within ~2s of each other at nearly the same price.
  Without merging same-symbol/same-side/same-`openCloseIndicator` fills
  (`sec` gap ≤2, price within 0.5%) into one qty-weighted-average execution
  *before* FIFO lot matching, one real order inflates into 3-7 separate
  journal rows — this is what caused the "too many trades last month"
  complaint. Verified live: 21 raw SNDU fills on 2026-08-06 → 5 real trades.
- **This is a heuristic, not authoritative.** The Flex query as currently
  configured in IBKR doesn't expose an order-ID field, only `tradeID` (per
  execution, not per order), so the merge guesses from time+price proximity.
  If the IBKR Flex Query is ever reconfigured to include **IB Order ID**
  (Client Portal → Reports → Flex Queries → edit the Trades query → add
  column), switch the merge key to that field instead — it removes the
  guesswork entirely and would resolve the residual ambiguous clusters
  noted below.
- **Retroactive cleanup is partial, by design.** On 2026-08-13, existing
  fragmented rows were merged only for groups that could be proven safe
  (all raw fills matched to existing rows 1:1, all closed at the identical
  exit price/date, zero manual notes on the rows being removed) — 42 groups
  for `5f72e0bb-…` (334→263 active rows), 1 group for `9f9ffff4-…`.
  Ambiguous clusters (mixed/partial FIFO matches, e.g. SNDQ/SNDU on some
  days) were deliberately left untouched rather than guessed at. Rollback
  script: `rollback-fill-consolidation-2026-08-13.sql` (scratchpad, not
  committed).
- **`detect_fragmented_trades(p_user_id uuid)`** — a Postgres helper
  function (in `supabase/migrations/20260813_data_health_checks.sql`,
  alongside `data_health_check`) flags symbol/day clusters of ≥3 active IBKR-sourced
  trades as a periodic safety-net check. A nonzero result isn't proof of a
  bug by itself (could be genuine high-frequency day trading) — verify
  against the raw Flex XML the same way the 2026-08-13 fix was verified
  before assuming re-fragmentation.
- **`ibOrderID` is now the authoritative merge key when present** (same day,
  commit `b2f0345`). Not every account has that Flex column configured — the
  time/price heuristic above is still the fallback, so both paths must keep
  working (`flexParseXML`'s `byOrderId` / `noOrderId` split). If re-touching
  this function, watch out for the exact bug this fix introduced and caught
  in live Playwright verification: `list.reduce(fn, {...list[0]})` still
  visits index 0, double-counting the first fill in a merged group — must be
  `list.slice(1).reduce(fn, {...list[0]})`.
- **`closed_shares` must never exceed `shares` on a single row** — found
  2026-08-13, pre-existing (predates every fix above), affected 65 rows
  across both IBKR-connected accounts. Root cause: in unmerged fragmentation
  groups, one representative row's `closed_shares` had accumulated the whole
  group's cumulative exit volume instead of just its own fragment's — while
  sibling rows in the same group already correctly showed their own smaller
  amount. Confirmed by cross-checking every flagged row's `ibkr_id` against a
  fresh from-scratch re-parse of the raw Flex XML with the current (correct)
  algorithm. Fix applied was `closed_shares = shares` (capping), NOT
  re-merging the group — matches the existing sibling rows' own correct
  state and doesn't relitigate which fragmentation groups are safe to merge.
  **One row (GROY, account 9f9ffff4) needed the opposite fix** — `shares`
  itself was wrong (110 instead of 113), not `closed_shares` — verify which
  field is actually wrong per-row before assuming "always cap closed_shares".
  This directly overstated P&L (`(exitPrice-entryPrice)*closedShares`) for
  every affected row until fixed. Rollback:
  `rollback-closedshares-invariant-2026-08-13.sql` (scratchpad).
- **RESOLVED (commit `baf222c`) — the resync-revert bug, and the actual cause
  of the `closed_shares > shares` rows above.** An earlier note here blamed
  the existing-row *matching* logic; that was wrong. Two defects in
  `_flexImportInner`, both now fixed — keep both in place:
  1. **Updates must write only the changed fields, never a full row.** The
     persist step used `.update(_tradeToRow(trade))`, and `_tradeToRow` builds
     *every* column from the in-memory copy. So a sync silently re-wrote
     `shares`/`entry_price` from whatever the journal held at page-load —
     reverting any change made since (another device, another tab, a
     server-side correction). That is exactly how account `9f9ffff4`'s AIR
     trade (id 101) came back with its pre-merge `shares=1`/`entry_price=84.77`
     while `closed_shares`/`commission` stayed at the correct merged values.
     A `patch` object is now built alongside each change and written instead.
  2. **The exit half must not be copied onto a row of a different size.**
     `flexParseXML` merges SMART-router fills that the journal may still hold
     as separate rows. Matching by `ibkr_id` then found the fragment row and
     copied the *merged order's* `closedShares` onto it while leaving `shares`
     at the fragment — producing `closed_shares > shares` and overstating
     P&L. Entry-side fields deliberately are not synced (a hand-entered
     position matched via `looksLikeSameManualTrade` must keep the user's own
     numbers), so the only safe move when sizes disagree is to skip the row;
     consolidating a fragmented group stays a separate, deliberate operation.
     The `sameSize` guard does this, and the orphan-close `candidates[0]`
     fallback is guarded the same way.
  Verified by replaying all three real scenarios (the AIR revert, a fragmented
  row, and a legitimate partial→full close) against the fixed logic, and on
  the live deployed page. Without fix #2 the 65-row cleanup above would have
  been undone on the very next sync — confirmed by re-parsing the raw XML and
  diffing against the post-cleanup DB state.
- **`_dedupeTrades` must never remove a broker-tagged row** (commit `63481e2`).
  It grouped only on symbol+entryDate+entryPrice, so IBKR's several
  same-symbol/day/price SMART-router fills looked identical — the "נקה
  כפילויות" button offered to permanently delete **73 real trades** across two
  accounts, each with its own distinct `ibkr_id`. A broker execution id is
  unique per fill, so two rows carrying different ids are never copies of each
  other. `shares` is now part of the identity key too (different size =
  different position), and only untagged rows are ever removable.
- **Every import path must set `closedShares` on a closed position.**
  `renderMonthlyTracker` selects on `exitPrice > 0 && closedShares > 0`, which
  is a *different* closed-test than `isClosed()` (that one accepts a close date
  or a partial alone). The CSV broker import (`biParseRows`) was the one path
  that never set it, so CSV-imported closed trades were counted everywhere
  except the monthly tracker, which showed an empty month. Fixed by setting
  `closedShares: shares` when the row carries an exit price — matching the
  Bybit and manual broker paths. The two closed-tests currently agree on all
  live rows; if a path ever produces partials with no final `exitPrice` they
  will diverge again, so prefer `isClosed()` in any new aggregation.
- **`closedShares` means TOTAL closed volume, including every partial in `t`.**
  `calcPL` computes the final leg as `closedShares - sum(t[].shares)`, so a row
  using the other convention (`closedShares` = only the last leg) silently
  drops that leg from P&L. The seeded demo data contained both conventions —
  RDDT correct, HIPPO wrong — and the HIPPO row had been persisted to a real
  account. Keep any new write path on the "total" convention.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-23)

- **The TLG (Interactive Israel) import fabricated P&L.** `tlgParse` bucketed a
  symbol's fills into `buys`/`sells` and then, for **every** buy, scanned the
  whole `sells` list for anything dated on or after it. Nothing was ever
  consumed, so two buys of one symbol followed by a single sell closed **both**
  buys against that same sell — the P&L and that sell's commission were counted
  once per buy. `ls` was also hardcoded to `'L'`, so a short's opening SELL fell
  into the sells bucket, disappeared as a position, and corrupted the matching
  of the real buys around it. Replaced with FIFO lot matching that consumes
  `lot.left`, honours the O/C column (`opensOnly`), sorts fills chronologically
  (the export is not guaranteed ordered), splits each fill's commission across
  only the lots it actually closed, and leaves the **final** leg to `exitPrice`
  rather than listing it in `targets` — `calcPL` prices
  `closedShares - sum(t[].shares)` at `exitPrice`, so listing every leg makes
  the remainder zero and drops the last leg from P&L.
  **Zero live rows ever came from this path** (`notes_keep = 'יובא מאינטראקטיב
  ישראל'` returns nothing), so there was nothing to repair — the bug was latent
  and would have hit on first real use.
- **The orphan-close handler could only ever apply one close per row.**
  Candidates were filtered on `!x.exitPrice`, so setting the exit from the first
  orphan execution excluded that row from the second, which then found no
  candidate and was silently dropped. ONDS (id 50, `6f73a6c3`) hit this and was
  finished by hand. Candidates are now matched on **remaining volume**
  (`room = shares - closedShares`), closed volume **accumulates**, and — this is
  the subtle half — the exit already on the row is pushed into `t` as an
  explicit leg *before* `exitPrice` is repointed at the new execution.
  Without that, the earlier close silently reprices to the newer one, because
  `calcPL` prices everything not covered by a leg at `exitPrice`.
- **Two IBKR accounts have a 29-day Flex window, and they are exactly the two
  that produce orphan closes.** Measured from the cached statements:

  | account | window | days | orphans seen |
  |---|---|---|---|
  | `6f73a6c3` | 20260525-20260623 | 29 | yes (ONDS) |
  | `dcb5bdba` | 20260722-20260820 | 29 | yes (POET, SOFI) |
  | `9f9ffff4` | 20250821-20260820 | 364 | none |
  | `5f72e0bb` | 20250821-20260820 | 364 | none |

  An orphan close *is* the symptom of too short a window: the closing execution
  is inside it while the opening one is not. **The fix is in IBKR, not in this
  code** — Client Portal → Reports → Flex Queries → edit the Trades query →
  Period = "Last 365 Days" (see the `ibkr_flex_period_1001` note: 30-day periods
  also cause the 1001 error on `SendRequest`). Until those two queries are
  changed, POET 101 @7.462 (2026-07-24) and SOFI 60 @16.552 (2026-07-23) stay
  unapplied — do not guess them into a row.
- **`6f73a6c3`'s sync has been dead since 2026-06-24** (last `fetched_at`; the
  other three refreshed 2026-08-21). Its last journal entry is 2026-06-23.
  Check the account's Flex token before assuming its data is merely quiet.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-23, council review)

- **Stage 3 of the holdings migration is done — `investments.holdings` (jsonb)
  is retired.** `invLoadFromDB` reads only `investment_holdings`, no fallback
  branch; `_invSaveWrite` no longer writes `holdings` onto the `investments`
  row (it still writes `deposits`/`currency`/`alloc_targets` and carries the
  optimistic-lock `updated_at` stamp — those were never part of the
  migration). **Do not re-add a jsonb fallback** — the column is intentionally
  frozen dead weight now, not a live rollback path; reviving it would silently
  serve a stale snapshot to a genuine read error instead of surfacing it.
  `data_health_check_core`'s `holdings_doc_row_drift` check was retired in the
  same migration for the same reason: it would misfire on the first holding
  edit anyone makes now that the jsonb side never updates again. Backups:
  `investments_backup_20260823`, `investment_holdings_backup_20260823`.
- **`data_health_check()` gained `ibkr_sync_stalled`.** `ibkr-alert` (the
  existing Telegram alert) only ever looks at users who already have
  `flex_sync_log` rows in its window — a user filtered out of `ibkr-cron`'s
  `targets` before it logs anything (a wiped or never-set `flex_query_id`)
  produces **zero** log rows, neither ok nor fail, and is invisible to it by
  construction. This is exactly how `6f73a6c3` went undetected for two months.
  The new check flags any account with a `flex_query_id` or a prior successful
  fetch that has had none in 4+ days. **Do not key this off
  `trades.ibkr_id is not null`** — `6f73a6c3` and `dcb5bdba` import untagged
  rows (no Trade ID column configured in their Flex query), so that condition
  silently excludes exactly the two accounts most prone to going stale; a
  first draft of this check did exactly that and returned 0 live hits. Use
  `flex_statement_cache` row existence instead — it doesn't depend on tagging.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-25, council review)

- **A pre-commit hook now runs `tests/logic.test.mjs` automatically** whenever
  `dashboard.html` or the test files themselves are staged — `.githooks/pre-commit`,
  wired via `git config core.hooksPath .githooks` (one-time per clone, see
  `tests/README.md`). A council session found the same gap two sessions in a
  row: every historical regression in this file was caught by CI *after* push,
  never before, and "run the tests first" as a written instruction to an LLM
  that writes every diff is a compliance ask that LLM can skip or claim was
  done. **Do not replace this with an instruction in a commit-message template
  or similar honor-system substitute** — the whole point is that the commit
  cannot physically complete without a real, fresh pass. Verified live: a
  deliberately broken `calcPL` (`let pl = 999999`) failed 6 tests and the
  commit was refused with exit 1; reverting and re-running confirmed 102/102
  and a clean commit goes through untouched.
- **This hook only covers the journal's Node suite (Layer 1).** The screener's
  `tests/run-tests.py` needs Playwright and a live browser — too slow/flaky
  for a blocking local gate — so it stays CI-only, which was already a
  required job before this change. Don't try to force it into this hook.
- **The screener's `tests/assertions.js` suite (81→101 assertions this
  session) is a separate repo with its own CI gate**, not covered by this
  journal-repo hook. If a fix ever touches both repos in one sitting, run both
  suites explicitly — this hook will not catch a screener regression.

## Still needs the user, not code (as of 2026-08-25, second council session
## in a row to flag this)

- **IBKR Flex Query Period is still 29 days on `6f73a6c3` and `dcb5bdba`.**
  Unchanged since the 2026-08-23 note below — a 5-minute click in Client
  Portal → Reports → Flex Queries, not something an LLM can do from here.
  Every orphan-close workaround in this codebase exists because of this one
  setting. The 2026-08-25 council's literal top recommendation was "fix this
  before writing another line of code" — flagging again because two straight
  sessions haven't moved it, which is itself worth noticing.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-26, full health audit)

- **Every `supabase/functions/*/` directory must have a deploy line in
  `.github/workflows/deploy.yml`.** `ibkr-cron`, `ibkr-alert` and `push-daily`
  were missing from that list and so had **never** been deployed by CI — a
  green `deploy-functions` job meant nothing for them, and `ibkr-cron` (the
  main IBKR sync) sat on a version from 2026-08-09 while commits kept landing.
  A build step now fails when a directory has no deploy line; **do not replace
  it with a comment or a checklist** — same honor-system objection as the
  pre-commit hook above. Quick check on any Edge Function: `get_edge_function`'s
  `entrypoint_path` shows `c:\home\runner\work\...` when CI deployed it and a
  local temp path when someone deployed by hand.
- **Broker health must be evaluated per `(user, broker)`, never per user.**
  `ibkr-alert` grouped on `user_id` alone, so one working broker masked a
  broken one on the same account: a Bybit key that expired 2026-08-22 failed
  183 consecutive times over four days in complete silence because the same
  user's IBKR sync kept succeeding and pushed `ok` above 0.
- **A staleness window must match the job's cadence.** `bybit_sync_stalled`
  uses **12 hours**, not the 4 days `ibkr_sync_stalled` uses, because
  `bybit-sync` runs every 30 minutes — 4 days there is 192 failed runs before
  anyone is told. Verified against live data: the 4-day form returned **0**
  while the key had already been dead for most of four days. Don't copy the
  interval across when adding a check for a new job.
- **`data_health_check_core` is SECURITY INVOKER with `search_path=public`** —
  it cannot read `vault.secrets`, so no check in it may key off Vault
  credentials. `bybit_sync_stalled` uses "has bybit sync-log rows OR holds
  bybit-tagged trades" instead; the trades half is what survives a credential
  wipe, which is exactly how `6f73a6c3`'s dead sync stayed invisible (its
  `flex_query_id` is NULL *and* it has zero Vault flex_token rows — the
  credentials were wiped outright, it is not a bad token).
- **`broker_balances` is read-only for users.** It was created with a `FOR ALL`
  policy, which let the browser overwrite a *broker-derived* equity figure that
  feeds the Kelly sizing suggestion and the STEM exposure alert — making it no
  more trustworthy than the manual `user_settings.portfolio_total` it exists to
  replace. Writes come only from `bybit-cron` / `ibkr-cron` under the service
  role, which bypasses RLS.
- **Applying a migration through the Supabase MCP does NOT create the file.**
  `create_broker_balances` existed only in the database until it was caught in
  this audit. Write the `supabase/migrations/*.sql` file in the same turn as
  the `apply_migration` call, every time.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-27)

- **A partially-closed row is BOTH closed and open.** The open-position views
  (`_updateLivePL`, the STEM focus list, the exposure alert) filtered on
  `!t.exitPrice`, so setting any exit price at all hid the shares still held.
  Verified fill-by-fill against raw Flex XML: CRWV held 20 shares while the
  journal's open-position views could only see 12. Use **`isOpenPosition(t)`**
  (`openShares(t) > 0`), never an exit-price test — `isClosed()` answers "does
  this row have realised P&L", which is a different question and both can be
  true at once.
- **`close_date` must not be set on a row that still holds stock.** Five rows
  (CRWV/RDDT/ONDS/ORCL/HOOD) had it, which is what
  `closed_row_unexplained_volume` was flagging. **`shares` and `closed_shares`
  were both correct** — the reflex of "cap closed_shares" would have destroyed
  good data. Confirmed against the raw XML for every verifiable row before
  touching anything (ORCL: bought 12, sold 2, 10 genuinely still open).
  Backup: `trades_backup_20260827_partial_close`.
- **`half_closed_row` used to flag legitimate partial closes.** Clearing the
  five `close_date`s sent `closed_row_unexplained_volume` to 0 and immediately
  sent `half_closed_row` to 5 — the two checks disagreed about which state is
  correct. Only a row that has closed its *full* size is actually missing a
  close_date; the check now says `closed_shares >= shares`. If you add a check
  about close_date/exit_price, make sure it agrees with the partial-close shape
  in the SOFI test (shares 90 / closedShares 25 / no targets / no close date).
- **The Kelly maths lives in `kellyHalfPct(winRate, avgWin, avgLoss)`**, split
  out from the journal lookup so it is testable. It feeds the position sizer
  directly, so an inversion suggests a *larger* position off a *worse* edge. A
  negative edge must return `null`, never the 0.1% floor — that would recommend
  sizing into a losing system.
- **CI now asks Supabase what is actually deployed.** The older guard only
  greps `deploy.yml`, so it can prove a deploy line exists but not that the
  function reached the server. The new step lists ACTIVE functions via the
  Management API and fails when a repo directory is missing from it. It checks
  existence, **not freshness** — the CLI skips redeploying an unchanged
  function, so asserting a recent `updated_at` would fail on every untouched one.
- **`my_broker_sync_health()`** (SECURITY DEFINER, `auth.uid()`-scoped) is how
  the browser learns a broker went silent; `flex_sync_log` itself stays
  RLS-locked with zero policies. Don't open that table up to add a UI signal —
  extend the RPC instead.

## ⚠️ Don't reintroduce these regressions (fixed 2026-08-28, Market Pulse latency)

- **A TTL-only cache is not a cache at this traffic level.** `market_cache` rows
  were measured **30 minutes old against a 5-minute TTL** — all four of them, at
  the same time. With a handful of users nobody arrives inside the TTL window, so
  the row is essentially always expired and *the user* pays the cold path in the
  foreground: 37 Yahoo tickers for `theme-tracker`, CNN plus 11 sector ETFs for
  `fear-greed`. **Shortening the TTL makes this worse, not better** — it only
  widens the window in which a visitor is the one doing the fetching. The fix is
  `_shared/swr.ts`: a stale row is returned immediately and refreshed via
  `EdgeRuntime.waitUntil` behind the response.
- **Every SWR cache needs a `maxStaleMs`, not just a TTL.** Past that bound the
  data is too old to put on screen and the request blocks on a real fetch. This
  is also the safety net for a background refresh that gets killed by the
  runtime's wall-clock/CPU cap (documented Supabase behaviour): the row keeps
  aging until it crosses the bound and someone refetches in the foreground.
  Current bounds: fear-greed 6h, theme-tracker 24h, crypto-fear-greed 48h.
- **`EdgeRuntime.waitUntil` is optional-chained on purpose** —
  `(globalThis as any).EdgeRuntime?.waitUntil?.(p)`. It exists in hosted Edge
  Functions, but if it ever doesn't, the absence must degrade to "cache never
  refreshes in the background", not to a thrown ReferenceError on every request.
- **`supabase/functions/_shared/*_test.ts` runs as a required CI job** (a
  `deno test` step next to the Node suite, since the Node suite cannot reach Deno
  TypeScript). The SWR failure mode is *silent* — flip a comparison or drop the
  waitUntil and the page still works, it just quietly returns to fetching in the
  foreground. The "did not wait on the refresh" test holds the refresh promise
  open and **deadlocks rather than passes** if `serveCached` ever awaits it;
  don't weaken it to a call-count assertion — `refresh()` is invoked
  synchronously up to its first await, so a count of 0 is simply wrong (this was
  caught by the test failing on its first run).
- **The client keeps the last payload in localStorage** (`_pulseCacheRead` /
  `_pulseCacheWrite`, prefix `pulse_cache_`) so the two Fear & Greed widgets,
  the STEM badge that rides the fear-greed payload, and the Market Pulse tab all
  paint a real number on the first frame. `_ttData` alone was in-memory only, so
  every page reload sat on "Loading..." for a full cold fan-out. **A failed
  refresh must not overwrite a cached reading with "Unavailable"** — the catch
  blocks are conditional on there being no cache.
- **`personal-stem` caches per SYMBOL, not per request** (`stem-5d-returns`, one
  row holding `{TICKER: {r, ts}}`). A 5-day return is the same number for every
  user, but the function used to re-fetch the whole focus list from Yahoo on
  every page load — up to 60 parallel calls with the badge hidden until the
  slowest landed, and no cache at any layer. **Don't key this per user or per
  request**: the whole saving comes from symbols being shared. The write
  re-reads the row and merges rather than overwriting the copy read at the top
  of the request, or a concurrent request's symbols are silently dropped; and it
  prunes entries past the bound, or the row grows forever as symbols leave focus
  lists.
- **A malformed cache entry must count as missing, never fresh.**
  `Date.now() - undefined` is `NaN` and *every* comparison against `NaN` is
  false, so a naive age test (`age > ttl`) files a broken entry under "fresh"
  and serves a reading that does not exist. `partitionByAge` checks the shape
  before the age. Covered by a test that fails against the naive version.
- **The backup tables are not dead weight — they are the only rollback path.**
  `trades_backup_*`, `investments_backup_*`, `trades_restored_*`: nine tables,
  ~160 kB total. PITR is not enabled on this project (it needs a paid plan), so
  these are the sole means of undoing a bad data correction. Do not "tidy them
  up"; the storage argument for deleting them is worth nothing against that.

## ⚠️ The screener shares this Supabase project — function names collide

- **`supabase/functions/<name>` is a namespace shared with the sibling
  `stock-screener` repo**, which deploys into the same project
  (`fnklrqxwyeibfptaxewf`). On 2026-08-28 this repo added its own `ohlc` for the
  trade-review chart and CI deployed it straight over the screener's `ohlc`.
  Theirs returns `{symbol, bars:[{t,o,h,l,c,v}]}` and authenticates with the
  anon key; the duplicate returned `{symbol, candles:[...]}` and required a user
  JWT — so **every chart in the screener started returning 401**, and neither
  repo's CI noticed, because each only checks that its *own* functions exist.
  Restored by re-running the screener's `deploy-functions` workflow
  (`workflow_dispatch`); the journal now calls the screener's `ohlc` instead of
  keeping a second copy.
- A CI step, **"No function name collides with the screener's"**, now fails the
  build if a directory named `ohlc`, `scan-universe` or `daily-scan` appears
  here. **Before adding any new edge function, check
  `c:/Users/david/stock-screener/supabase/functions/` first** — and prefer
  calling the existing function over writing a parallel one.
- The screener's `ohlc` already does more than a fresh copy would: per-symbol
  memory + `market_cache` caching, a `range` param (`3mo` / `1y`), gap-filling
  from hourly bars, IP rate limiting, and `mapSymbol` (BRK.B -> BRK-B).

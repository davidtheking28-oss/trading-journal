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

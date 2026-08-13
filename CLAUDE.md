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
  function (not in this repo's migrations tracked here; applied directly
  via Supabase MCP) flags symbol/day clusters of ≥3 active IBKR-sourced
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
- **⚠️ OPEN BUG, not yet root-caused:** a resync can revert a row's `shares`
  / `entry_price` back to a stale pre-merge value while leaving
  `closed_shares` / `commission` at the correct merged value — reproduced
  live on account `9f9ffff4`'s AIR trade (id 101) after a legitimate resync
  that happened after that row had already been correctly merged. `_flexImport`'s
  update path (~line 12071-12088) never writes `shares`/`entryPrice` on an
  existing-row update by design, which rules out that path as the direct
  cause — the likely culprit is the *existing-row matching* logic (`~line
  12058-12069`, especially the `looksLikeSameManualTrade` fallback) matching
  the wrong row or re-deriving a different primary `ibkr_id` on a later parse
  of the same fills. Needs dedicated investigation with real sync traffic
  (or instrumented logging) before it can be fixed with confidence — do not
  guess-patch the matching logic without reproducing it deterministically.

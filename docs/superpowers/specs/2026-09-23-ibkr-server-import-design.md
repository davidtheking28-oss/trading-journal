# Move IBKR Import Server-Side

## Problem

IBKR import (`flexParseXML` + `_flexImportInner`) runs only in the browser,
triggered by opening the app. `ibkr-cron` fetches and caches the Flex XML on a
schedule, but nothing parses/writes it unless a user visits. `flex_sync_log`
marks a fetch `ok` regardless — an account that stops opening the app shows a
permanently healthy sync while real fills pile up unimported (this is exactly
how `dcb5bdba` went 0-imported for weeks; see CLAUDE.md 2026-09-17).
`flex_fetched_not_imported` (added the same day) now detects the gap, but
detection isn't a fix — the import still only runs when someone opens a tab.

## Decision: replace, not supplement

The server becomes the sole importer. The browser-side call to
`_flexImportInner`'s write path is removed once the server is trusted; the
browser keeps read-only display of `trades`. Running both permanently would
mean reconciling two writers to the same rows indefinitely — pure risk for no
benefit once the server is proven correct.

## Code sharing: one shared module

`_flexImportInner`/`flexParseXML` and their helpers (SMART-router fill
consolidation, `ibOrderID`/time-price merge, `_orphanClose` +
`last_close_dt`, the no-indicator reversal check, FIFO matching, `patch`-only
writes) move to a new plain-JS ES module:

```
supabase/functions/_shared/flex-import.mjs
```

Both sides import it as the single source of truth:
- **Browser**: `dashboard.html` adds `<script type="module">import * as FlexImport from './flex-import.mjs'</script>`, served as a sibling file on GitHub Pages (no build step — still just static files).
- **Server**: the new `ibkr-import` Edge Function imports it directly (Deno supports plain ESM imports with no transpile).

The functions currently call `_sb` (the browser's global Supabase client)
directly for reads/writes. They're refactored to take a `db` parameter (an
object exposing the handful of methods actually used: fetching existing
trades for a user, upserting a patch, etc.), which each side injects with its
own client (anon+session on the browser, service role on the server).

`tests/harness.mjs`'s regex-extraction from `dashboard.html`'s raw text
becomes unnecessary for these functions — `tests/logic.test.mjs` switches to
a plain `import` of the real module. This is a **testing improvement**, not
scope creep: the same 178 tests now run against the actual shipped code
instead of a regex-extracted copy of it, which is strictly safer.

## Rollout: shadow mode, then cutover

**Phase 1 — extract, behavior-preserving.**
Move the logic into `flex-import.mjs`, refactor `dashboard.html` to import
and call it instead of its own inline copy. No behavior change. Verified by
the existing 178 tests passing unchanged (they'll need updating to import
the real module instead of extracting from text, but their assertions
don't change). This phase carries real risk on its own — it's a full-file
refactor of the most hardened logic in the codebase — so it ships and is
verified on its own before Phase 2 starts.

**Phase 2 — shadow mode.**
New `ibkr-import` Edge Function (separate from `ibkr-cron`, which keeps doing
only the fetch), on its own cron schedule. For each `flex_statement_cache` row
with `stale_since`/`confirm_stale_since` set (i.e. fetched but not yet
imported by the browser): parse with the shared module, compute what it
*would* write, diff against the trades that already exist for that
user+ibkr_id, and log any discrepancy to a new `flex_import_shadow_log` table
(user_id, ibkr_id, kind: missing/extra/mismatched, expected, actual, created_at).
**No writes to `trades` in this phase.** The browser keeps importing for real,
unaffected.

**Phase 3 — review.**
Manually review `flex_import_shadow_log` for ~1-2 weeks across all IBKR
accounts (`9f9ffff4`, `5f72e0bb`, `6f73a6c3`, `dcb5bdba`). A clean run (zero
unexplained diffs) across that window, on all four accounts, is the gate —
not a fixed calendar date. Any diff gets root-caused before moving on, the
same way every fix in this file's history has been.

**Phase 4 — cutover.**
`ibkr-import` starts writing for real (still under a kill switch —
`user_settings`-scoped or global flag checked first). The browser's call to
the write path is removed; it keeps calling the read side only, or is
removed entirely if nothing browser-side still needs `flexParseXML`.

## Data flow (shadow mode)

```
ibkr-cron (existing, unchanged)
  → fetches Flex XML → flex_statement_cache

ibkr-import (new, cron)
  → for each cache row with stale_since set:
    → flex-import.mjs: parseXML → computeImportPlan(existingTrades)
    → diff plan vs current `trades` rows (user_id, ibkr_id)
    → diffs != empty → insert into flex_import_shadow_log
    → (no trades writes)
```

## Error handling

`ibkr-import` reports its own parse/compute failures to `client_errors`
(`app:'ibkr-import'`, service-role insert) — same shape as the browser's
existing `_reportClientError`, so it shows up in
`client_errors_accumulating` alongside everything else.
`flex_fetched_not_imported` stays relevant through shadow mode (the browser
is still the real importer); a new health check,
`shadow_diff_unresolved` (any `flex_import_shadow_log` row older than 48h
with no resolution), gets added ahead of Phase 4 so a stuck diff doesn't
sit silently.

## Testing

- Phase 1: existing 178 Node tests, now importing the real shared module.
- Phase 2: new Deno tests for `ibkr-import` — `computeImportPlan` diffing
  logic, and that it never calls a write RPC/table (asserted the same way
  the trade-chart skill's "no `setVisibleLogicalRange` outside `_applyChartView`"
  guard works — a source-level check that the function never references
  `trades` on the write side, so a future edit can't silently start writing
  during shadow mode without the test catching it).
- Phase 3: no new code, only manual review of shadow log output.
- Phase 4: a test asserting the kill switch actually blocks writes when off,
  and that the browser's write call is gone (or dead) once this ships.

## Out of scope

Fixing the two accounts still on a 29-day Flex window (`6f73a6c3`,
`dcb5bdba`) — user-side IBKR Client Portal setting, unrelated to where the
import code runs, tracked separately in CLAUDE.md.

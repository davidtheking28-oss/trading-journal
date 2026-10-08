# Tablet watchlist persistence and synchronization

## Reproduced defect and fix

The screener visibility-change handler refreshed only screener preferences. A watchlist changed in another device session was not explicitly refreshed when returning to an already-open tablet page. A browser regression reproduced this: the final cross-session MSFT visibility check timed out before the fix and passed afterward.

The handler now calls the existing `loadUserData()` path. This fetches both watchlist and preferences, preserves pending optimistic writes and rejects responses after an account change. A rejected refresh promise is caught. No database schema or RLS changes were made.

## Test coverage

`node --test tests/tablet-watchlist-sync.test.cjs` runs the actual screener HTML against a shared synthetic database adapter across separate browser contexts.

- Desktop star addition is scoped to the mock user and appears in the tablet watchlist after loading server data.
- Tablet removal persists and is reflected in the other context.
- Tablet addition persists after page reload.
- Saved AAPL appears in both table and gallery at 768, 820, 1024 and 1180px, without root horizontal overflow.
- Failed removal restores the star and saved membership.
- A cross-session addition appears when the tablet visibility-change event fires, without manually reloading the page.
- A saved ticker without cached quote data is named in the existing missing-data notice and retained in the watchlist count.
- No browser JavaScript errors occurred.

The existing screener regression checks also passed: 258 original and 92 additional checks.

## Limits

These are Chromium touch-emulation tests with synthetic account and persistence boundaries. They do not verify the user's live account, actual Supabase network connectivity, the journal iframe SSO handshake, RLS or physical iPad/Safari behavior. The synchronization fix refreshes on returning to a visible page; it does not add continuous realtime subscriptions.

The fix is local in `C:/Users/david/stock-screener/מסנן-מניות.html` and is not yet deployed.

## Confirmed user requirement: independent watchlist

The user clarified that watchlist is a separate category and must include every saved ticker regardless of the selected screener. Removed the cleanbase exception that hid rows with failed validation. Existing regression expectations were updated to retain failed rows and report the full saved count.

The watch view hides the screener criteria/preset panel, offers its own quote-refresh action, and clears a search inherited from scan results on entry. A deliberate search within the watchlist remains available. Cached rows appear in the table/gallery even when technical criteria fail; saved symbols without cached price data remain named in the missing-data notice.

The expanded browser test verifies both views against all eight screener selections, including failed validation and a leftover scan search. The 350 existing checks pass under the revised policy. These changes are also local and not yet published.

## Save-status follow-up

Added an atomic polite live status in the results header. It distinguishes pending writes, acknowledged account synchronization, rejected writes, read/network failures and device-only storage without a signed-in account. Save failures remain visible until the affected ticker is retried; another ticker's successful save does not erase them. Account changes reset the status and stale responses cannot update it.

Rejected write promises use the existing optimistic rollback behavior. A failed removal preserves the original added-at date. Server reads and local-to-account migration now handle rejected promises, and migration is not labeled synchronized before its upsert succeeds. The watchlist refresh control reads account state before refreshing quote data.

The synthetic browser test verifies delayed-write status, acknowledgement, failed removal, rejected read, read recovery, signed-out status and delayed local-list migration. All 350 regression checks and automated accessibility scans across 32 existing states passed (zero violations). This follow-up is local and has not yet been deployed; the independent-watchlist and visibility-sync changes above have already been published.

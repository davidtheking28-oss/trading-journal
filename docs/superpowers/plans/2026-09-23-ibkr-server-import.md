# IBKR Server-Side Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move IBKR Flex import (`flexParseXML` + `_flexImportInner`) into a shared module both the browser and a new server-side cron import, so trades import even when nobody opens the app.

**Architecture:** Extract the two functions into `supabase/functions/_shared/flex-import.mjs`, a dependency-free plain-JS ES module. Strip all DOM/UI calls out of `_flexImportInner` (it becomes pure I/O via an injected `ctx`, no `document`/`renderTable`/`toast`) so it runs identically in a browser `<script type="module">` and in Deno. Ship it behind a browser refactor first (Phase 1, behavior-preserving), then a log-only server import (Phase 2, shadow mode), then a manual review window (Phase 3), then cutover (Phase 4).

**Tech Stack:** Vanilla JS (ES modules, no build step), Deno Edge Functions, `npm:@xmldom/xmldom` for server-side XML parsing, Supabase Postgres.

**Spec:** [docs/superpowers/specs/2026-09-23-ibkr-server-import-design.md](../specs/2026-09-23-ibkr-server-import-design.md)

## Global Constraints

- No build step, anywhere — `flex-import.mjs` is loaded as a static file by both GitHub Pages and Deno, never bundled/transpiled.
- `_flexImportInner` must not import or call `document`, `toast`, `renderTable`, `renderOverview`, `renderStatistics`, or `initFilters` — those stay in `dashboard.html`'s caller.
- Every existing behavior documented in `CLAUDE.md`'s "Don't reintroduce these regressions" sections for `flexParseXML`/`_flexImportInner` (fill consolidation, `ibOrderID` merge, orphan-close idempotency via `last_close_dt`, the no-indicator reversal check, `patch`-only writes, `fullyClosed`/`close_date` gating) must survive extraction byte-for-byte in logic — Phase 1 is a move, not a rewrite.
- `tests/logic.test.mjs`'s existing 178 tests must all still pass after every task in Phase 1, with zero test assertions changed (only their setup/import mechanics may change).
- No writes to `trades` from `ibkr-import` before Phase 4 — Phase 2/3 is strictly read + log.

## Review Focus

- **A Deno environment with no `DOMParser` global at all** — `flexParseXML` calls `new DOMParser()` directly today; if the shared module hardcodes that, `ibkr-import` throws on its first XML the moment it's deployed, not caught by any of the 178 browser-oriented tests. Covered by Task 2's Deno-side parse test.
- **A cache row with `xml` and `xml_confirm` both present** — `_flexSyncFromCache` merges both statements into one `trades` array before calling `_flexImportInner` once; a shadow-mode diff computed from only one of the two would produce false "missing" diffs against every real account. Covered by Task 4's fixture using both.
- **An account with zero prior trades (first sync)** — the no-indicator reversal check searches `toInsert` (this batch) as well as existing rows specifically because a first sync has nothing saved yet; a diff computation that only queries the `trades` table would miss same-batch closes and misreport them as unimported. Covered by Task 4.
- **A `flex_import_shadow_log` row for a user who was later deleted, or an account with `flex_query_id` cleared** — `ibkr-import`'s per-account loop must skip accounts with no query id the same way `ibkr-cron`'s `targets` filter already does, or it wastes cycles (and produces noise diffs) fetching nothing. Covered by Task 3's query mirroring `ibkr-cron`'s existing target selection.
- **Two shadow-log rows for the same (user, ibkr_id) diff on consecutive cron runs** — without a dedupe key the log grows one row per run for a diff nobody has resolved yet, making the Phase 3 review noisy instead of "did anything change". Covered by Task 3's upsert-on-conflict.

---

## Phase 1 — Extract the shared module (behavior-preserving)

### Task 1: Create `flex-import.mjs` with `flexParseXML`

**Files:**
- Create: `supabase/functions/_shared/flex-import.mjs`
- Modify: `dashboard.html:15398-~15700` (remove the inline `flexParseXML` body once the import works — done at the end of this task, not before)
- Test: `tests/logic.test.mjs:1-130` (existing `flexParseXML` describe blocks — update only the import line)
- Test: `tests/harness.mjs` (add a thin re-export path)

**Interfaces:**
- Produces: `export function flexParseXML(xml, DOMParserImpl = globalThis.DOMParser)` — same return shape as today (array of trade-shaped objects), used by Task 2 and Task 3.

- [ ] **Step 1: Copy `flexParseXML` verbatim into the new file**

Read the full function body first:
```bash
sed -n '15398,15700p' dashboard.html
```
(The exact end line varies — find it by matching braces; it's the function immediately before the next top-level `function` declaration.)

Create `supabase/functions/_shared/flex-import.mjs`:
```js
// Shared between dashboard.html (browser, <script type="module">) and the
// ibkr-import Edge Function (Deno). No DOM/browser globals may be assumed —
// DOMParser is injected so the browser can pass its native one and Deno can
// pass npm:@xmldom/xmldom's.
export function flexParseXML(xml, DOMParserImpl = globalThis.DOMParser) {
  const parser = new DOMParserImpl();
  // ...paste the exact body from dashboard.html here, verbatim, only
  // changing the first two lines above...
}
```
Copy the body exactly as read in dashboard.html — every comment, every regex, unchanged. Only the first two lines (function signature and `new DOMParser()` → `new DOMParserImpl()`) differ from the original.

- [ ] **Step 2: Point `tests/harness.mjs` at the new file for `flexParseXML`**

In `tests/harness.mjs`, add near the top (after the existing `ROOT`/`SOURCE` constants):
```js
import { flexParseXML as _flexParseXML } from '../supabase/functions/_shared/flex-import.mjs';
import { DOMParser as StubDOMParser } from './harness.mjs'; // no-op if already in this file — see note below
export function loadFlexParseXML() {
  return (xml) => _flexParseXML(xml, StubDOMParser);
}
```
`StubDOMParser` is the existing `DOMParser` class already defined lower in this same file (the `StubDocument`-backed one at line ~99) — do not duplicate it, just reference it after moving the import to the top if a hoisting issue occurs (ES module top-level `import`s are hoisted regardless of where classes are declared later in the same file, so this works as-is).

- [ ] **Step 3: Update `tests/logic.test.mjs`'s `flexParseXML` import**

Change:
```js
const { flexParseXML } = load('flexParseXML');
```
to:
```js
import { loadFlexParseXML } from './harness.mjs';
const flexParseXML = loadFlexParseXML();
```
Leave every `describe`/`test` body in the `flexParseXML — ...` blocks (lines ~35-130, ~1114-1180) completely unchanged — only this one import line changes.

- [ ] **Step 4: Run the flexParseXML tests to confirm they still pass**

```bash
node --test tests/logic.test.mjs 2>&1 | grep -A2 "flexParseXML"
```
Expected: every `flexParseXML —` describe block passes, same count as before this task.

- [ ] **Step 5: Remove the inline copy from dashboard.html and import the shared module**

Delete the `function flexParseXML(xml) { ... }` block at `dashboard.html:15398` (the exact range confirmed in Step 1). In its place, near the top of the file's `<script>` block where other top-level helpers are declared, add:
```html
<script type="module">
  import { flexParseXML } from './supabase/functions/_shared/flex-import.mjs';
  window.flexParseXML = flexParseXML;
</script>
```
Every existing call site in `dashboard.html` (e.g. inside `_flexSyncFromCache`) calls `flexParseXML(...)` as a bare global — `window.flexParseXML = flexParseXML` keeps those call sites unchanged. Place this `<script type="module">` block before the main inline `<script>` block so `window.flexParseXML` is assigned before the main script runs (module scripts execute in order relative to each other and are deferred like `defer`, so this must load before the classic inline script — verify by checking the classic script tag has no `defer`/`async` and sits after this module tag in source order; if it does have `async`, move this module tag to be the very first `<script>` in `<head>`).

- [ ] **Step 6: Run the full Node suite**

```bash
node --test tests/logic.test.mjs
```
Expected: `178 passing` (or whatever the current total is — confirm it matches the count from before this task started, run once before Step 1 to record the baseline).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/flex-import.mjs tests/harness.mjs tests/logic.test.mjs dashboard.html
git commit -m "Extract flexParseXML into a shared module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Move `_flexImportInner` into the shared module, stripped of UI calls

**Files:**
- Modify: `supabase/functions/_shared/flex-import.mjs` (append `_flexImportInner`)
- Modify: `dashboard.html:13699-13977` (replace body with a call into the shared function + the UI-refresh code that used to live at the end of it)
- Test: `tests/logic.test.mjs:248-660` (existing `_flexImportInner` describe blocks)

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the file existing.
- Produces: `export async function _flexImportInner(trades, ctx)` where
  `ctx = { db, _sb, _currentUser, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades }`.
  Returns `{ imported, updated, newlyImported, insertFailed }` — same shape as
  today, **minus** any UI side effects (no more `initFilters()`/`renderTable()`/
  `renderOverview()`/`renderStatistics()`/`document.getElementById` calls inside
  it — those move to the dashboard.html call site). Used by Task 3.

- [ ] **Step 1: Read the exact current body to relocate**

```bash
sed -n '13699,13977p' dashboard.html
```
Confirm the end boundary is the closing `}` right before the `// Smart sync throttle` comment (line ~13979 today — re-confirm the exact number since Task 1 shifted line numbers below it if the shared-module extraction happened above this point; it didn't, `_flexImportInner` is above `flexParseXML` in the file, so line numbers here are unaffected by Task 1).

- [ ] **Step 2: Append the function to `flex-import.mjs`, replacing the tail with a plain return**

Append after `flexParseXML`:
```js
export async function _flexImportInner(trades, ctx) {
  const { db, _sb, _currentUser, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades } = ctx;
  let imported = 0, updated = 0;
  const newlyImported = [];
  const toInsert = [];
  const toUpdate = [];

  // ...paste every line from the original body VERBATIM, from `const sameEntry`
  // through the `if (insertFailed) toast(...)` line REMOVED (see next line)...

  // the original had: if (insertFailed) toast(`${insertFailed} עסקאות מ-IBKR נכשלו בייבוא`, 'error');
  // — DELETE this line entirely; the caller decides how to surface insertFailed.

  await _dedupeTrades();

  // the original then had initFilters()/renderTable()/renderOverview()/
  // renderStatistics()/document.getElementById(...) — DELETE all of that;
  // it moves to the dashboard.html caller in Step 4.

  return { imported, updated, newlyImported, insertFailed };
}
```
Every comment explaining *why* a piece of logic exists (the AIR/GROY/ANAB notes, the orphan-close idempotency note, the no-indicator reversal note, the `patch`-only-write note) must be copied verbatim — they are load-bearing documentation for future maintainers, not decoration, per `CLAUDE.md`'s existing regression log.

The one other change beyond deleting the UI block and the `toast` line: `_isDeletedImport` and `_dedupeTrades` were previously bare free variables (closure-captured globals in `dashboard.html`); they are now destructured from `ctx` at the top as shown. `db`, `_sb`, `_currentUser`, `_tradeToRow`, `_rowToTrade` were already referenced by those exact names in the body — no other line inside the function changes.

- [ ] **Step 3: Update `tests/logic.test.mjs`'s three `_flexImportInner` test groups**

There are three `describe` blocks that build their own `run()` harness via `extractFunction('_flexImportInner')` + `new Function(...)` (around lines 248, 524, 596 in the pre-Task-1 file — re-locate by searching `extractFunction('_flexImportInner')`). Replace each one's harness with a direct import. Example for the block at (old) line 324:

Before:
```js
function run(trades, { existing = [] } = {}) {
  const src = 'async ' + extractFunction('_flexImportInner');
  const updates = [];
  const inserts = [];
  let nextId = 100;
  const db = { stocks: existing.map(t => ({ ...t })), crypto: [] };
  const chain = table => ({ /* ... */ });
  const scope = { db, _sb: { from: chain }, _currentUser: { id: 'u1' },
    _tradeToRow: t => ({ ...t }), _rowToTrade: row => ({ ...row }),
    _isDeletedImport: () => false, _dedupeTrades: async () => {},
    initFilters: () => {}, renderTable: () => {}, renderOverview: () => {}, renderStatistics: () => {},
    toast: () => {}, document: { getElementById: () => null } };
  const names = Object.keys(scope);
  const factory = new Function(...names, `${src}\nreturn _flexImportInner;`);
  return { run: () => factory(...names.map(n => scope[n]))(trades), db, updates, inserts };
}
```

After:
```js
import { _flexImportInner } from '../supabase/functions/_shared/flex-import.mjs';

function run(trades, { existing = [] } = {}) {
  const updates = [];
  const inserts = [];
  let nextId = 100;
  const db = { stocks: existing.map(t => ({ ...t })), crypto: [] };
  const chain = table => ({
    update: patch => ({
      eq: () => ({ eq: () => { updates.push({ table, patch }); return Promise.resolve({ error: null }); } }),
    }),
    insert: row => ({
      select: () => ({
        single: () => { const withId = { ...row, id: nextId++ }; inserts.push(withId); return Promise.resolve({ data: withId, error: null }); },
      }),
    }),
  });
  const ctx = { db, _sb: { from: chain }, _currentUser: { id: 'u1' },
    _tradeToRow: t => ({ ...t }), _rowToTrade: row => ({ ...row }),
    _isDeletedImport: () => false, _dedupeTrades: async () => {} };
  return { run: () => _flexImportInner(trades, ctx), db, updates, inserts };
}
```
Move the `import { _flexImportInner } ...` line to the top of `tests/logic.test.mjs` (one import, reused by all three describe blocks — remove the per-block `extractFunction`/`new Function` entirely). Do this for all three blocks. Do not change any `test(...)` body, any assertion, or any fixture (`openLong`, `confirmSell`, etc.) — only the `run()` harness function and the new top-level import.

- [ ] **Step 4: Replace the dashboard.html body with a call into the shared function**

Replace `dashboard.html:13699-13977` (the whole original `_flexImportInner`) with:
```js
async function _flexImportInner(trades) {
  const { imported, updated, newlyImported, insertFailed } = await FlexImport._flexImportInner(trades, {
    db, _sb, _currentUser, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades,
  });
  if (insertFailed) toast(`${insertFailed} עסקאות מ-IBKR נכשלו בייבוא`, 'error');
  if (imported > 0 || updated > 0) {
    initFilters();
    if (imported > 0) {
      ['st', 'cr'].forEach(p => {
        const ys = document.getElementById(p + '-year');  if (ys) ys.value = '';
        const ms = document.getElementById(p + '-month'); if (ms) ms.value = '';
      });
    }
    renderTable('stock');
    renderTable('crypto');
    renderOverview();
    if (document.getElementById('tab-statistics')?.classList.contains('active')) renderStatistics();
  }
  return { imported, updated, newlyImported, insertFailed };
}
```
(`updateFailed`'s toast — `${updateFailed} עדכוני סנכרון נכשלו — הנתונים לא נשמרו` — stays INSIDE the shared function since it fires per-update during the loop and needs a `toast`-equivalent; re-check Step 2's paste: if the original toast call for `updateFailed` was left in the pasted body, replace it with a console.warn and add `updateFailed` to the returned object instead, then move its toast to this wrapper too, matching the `insertFailed` pattern above exactly. Confirm which is which by re-reading the original code from Step 1 of this task before deciding — do not guess.)

Add the module import alongside the one from Task 1:
```html
<script type="module">
  import { flexParseXML, _flexImportInner } from './supabase/functions/_shared/flex-import.mjs';
  window.flexParseXML = flexParseXML;
  window.FlexImport = { _flexImportInner };
</script>
```
(Merge this with Task 1's module `<script>` block rather than adding a second one.)

- [ ] **Step 5: Run the full Node suite**

```bash
node --test tests/logic.test.mjs
```
Expected: same passing count as the Task 1 baseline. If any `_flexImportInner` test fails, the cause is almost certainly the `updateFailed`/`insertFailed` toast placement from Step 4's caveat — re-read the original source before changing anything further (per `CLAUDE.md`'s standing rule: verify via the actual function output, not by re-reading control flow and assuming).

- [ ] **Step 6: Manual smoke test on the live page**

Open `dashboard.html` locally (`python -m http.server` from the repo root, browser to `localhost:8000/dashboard.html`), log in, and trigger a manual Flex sync (existing "סנכרן IBKR" button) against a real account. Confirm trades still import and the toasts/table refresh behave identically to before this task. This is the one step in Phase 1 that the Node suite cannot verify (it doesn't cover the `<script type="module">` load order or the real `_sb` client).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/flex-import.mjs tests/logic.test.mjs dashboard.html
git commit -m "Extract _flexImportInner into the shared module, UI-free

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Phase 2 — Shadow mode

### Task 3: `ibkr-import` Edge Function (log-only, no writes)

**Files:**
- Create: `supabase/functions/ibkr-import/index.ts`
- Create: `supabase/migrations/20260923_flex_import_shadow_log.sql`
- Modify: `.github/workflows/deploy.yml` (add the deploy line — required per the 2026-08-26 CI guard in CLAUDE.md)
- Test: `supabase/functions/_shared/flex-import_test.ts` (new Deno test)

**Interfaces:**
- Consumes: `flexParseXML`, `_flexImportInner` from Task 1/2's `flex-import.mjs` (imported directly, no changes needed to that file).
- Produces: rows in `flex_import_shadow_log`, consumed by Task 5 (Phase 3 review) and the `shadow_diff_unresolved` health check (Task 6).

- [ ] **Step 1: Write the migration for the shadow-log table**

Create `supabase/migrations/20260923_flex_import_shadow_log.sql`:
```sql
create table if not exists flex_import_shadow_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ibkr_id text not null,
  kind text not null check (kind in ('missing', 'extra', 'mismatched')),
  expected jsonb,
  actual jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, ibkr_id, kind)
);

alter table flex_import_shadow_log enable row level security;
create policy "user owns row" on flex_import_shadow_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```
The `unique (user_id, ibkr_id, kind)` constraint is what Task 3's Step 3 upsert relies on to avoid one row per cron run for the same unresolved diff (Review Focus item 5).

Apply it:
```
mcp__supabase__apply_migration with the SQL above, name "flex_import_shadow_log"
```

- [ ] **Step 2: Write the diff-computation logic as a small, separately-testable function**

Append to `supabase/functions/_shared/flex-import.mjs` (same file — this is pure logic, not I/O, so it belongs alongside `_flexImportInner`):
```js
// Compares what _flexImportInner WOULD do (given the cached XML and the
// trades already on file for this user) against what's actually there,
// without writing anything. Used only by ibkr-import in shadow mode.
export function diffImportPlan(existingTrades, plannedInserts, plannedUpdates) {
  const diffs = [];
  for (const t of plannedInserts) {
    const already = existingTrades.some(x => !x.deleted && x.ibkr_id === t.ibkr_id);
    if (!already) diffs.push({ ibkr_id: t.ibkr_id, kind: 'missing', expected: t, actual: null });
  }
  for (const { row, patch } of plannedUpdates) {
    const mismatched = Object.entries(patch).some(([k, v]) => {
      const current = row[k === 'exit_price' ? 'exitPrice' : k === 'closed_shares' ? 'closedShares'
        : k === 'close_date' ? 'closeDate' : k === 'last_close_dt' ? 'lastCloseDt' : k];
      return JSON.stringify(current ?? null) !== JSON.stringify(v ?? null);
    });
    if (mismatched) diffs.push({ ibkr_id: row.ibkr_id, kind: 'mismatched', expected: patch, actual: row });
  }
  return diffs;
}
```
This needs `_flexImportInner` to expose its computed `toInsert`/`toUpdate` before it writes them — since Task 2 already made it pure-ish (writes only happen via the injected `ctx._sb`), the cleanest way to get the plan without writing is to call `_flexImportInner` with a `ctx._sb` whose `update`/`insert` chain returns success WITHOUT actually touching the database (a local no-op stub identical in shape to the test harness from Task 2, Step 3), then read back `db.stocks`/`db.crypto` mutations it made in-memory and the `newlyImported`/`updated` counts it returns. Use that approach instead of hand-rolling a parallel `diffImportPlan` that duplicates `_flexImportInner`'s matching logic (duplicating that logic is exactly the risk the shared-module decision in the spec was meant to avoid). Rewrite Step 2 as:

```js
// Runs the real import logic against an in-memory, no-op "database" so the
// result can be inspected without writing anything — used by ibkr-import in
// shadow mode. Reuses _flexImportInner itself rather than re-implementing
// its matching rules, so shadow mode can never drift from what a real
// import would do.
export async function computeShadowDiff(trades, existingTrades) {
  const db = { stocks: existingTrades.map(t => ({ ...t })), crypto: [] };
  const noopChain = () => ({
    update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    insert: row => ({ select: () => ({ single: () => Promise.resolve({ data: { ...row, id: `shadow-${row.ibkr_id}` }, error: null }) }) }),
  });
  const result = await _flexImportInner(trades, {
    db, _sb: { from: noopChain }, _currentUser: { id: 'shadow' },
    _tradeToRow: t => ({ ...t }), _rowToTrade: row => ({ ...row }),
    _isDeletedImport: () => false, _dedupeTrades: async () => {},
  });
  return result; // { imported, updated, newlyImported, insertFailed }
}
```
Delete the earlier `diffImportPlan` sketch above — `computeShadowDiff` replaces it. A nonzero `imported` or `updated` count against the current `existingTrades` snapshot IS the diff: it means the browser hasn't imported something the server logic says it should have.

- [ ] **Step 3: Write `ibkr-import/index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";
import { flexParseXML, computeShadowDiff } from "../_shared/flex-import.mjs";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (_req: Request) => {
  // Mirrors ibkr-cron's own target selection (accounts with a flex_query_id
  // or a prior successful fetch) — see CLAUDE.md 2026-08-26 on why this must
  // stay in sync with that filter rather than a simpler "has ibkr_id trades"
  // check, which excludes exactly the accounts most prone to going stale.
  const { data: rows, error } = await sb
    .from("flex_statement_cache")
    .select("user_id, xml, xml_confirm, stale_since, confirm_stale_since")
    .or("stale_since.not.is.null,confirm_stale_since.not.is.null");
  if (error) {
    await sb.from("client_errors").insert({
      kind: "ibkr_import_cache_read", message: error.message, app: "ibkr-import",
    });
    return new Response("error", { status: 500 });
  }

  for (const row of rows ?? []) {
    try {
      const trades = [
        ...(row.xml ? flexParseXML(row.xml, DOMParser) : []),
        ...(row.xml_confirm ? flexParseXML(row.xml_confirm, DOMParser) : []),
      ];
      if (!trades.length) continue;

      const { data: existing } = await sb
        .from("trades")
        .select("*")
        .eq("user_id", row.user_id)
        .eq("deleted", false);

      const plan = await computeShadowDiff(trades, existing ?? []);
      if (plan.imported > 0 || plan.updated > 0) {
        await sb.from("flex_import_shadow_log").upsert({
          user_id: row.user_id,
          ibkr_id: trades[0]?.ibkr_id ?? "unknown",
          kind: plan.imported > 0 ? "missing" : "mismatched",
          expected: plan,
          actual: null,
        }, { onConflict: "user_id,ibkr_id,kind" });
      }
    } catch (e) {
      await sb.from("client_errors").insert({
        kind: "ibkr_import_parse", message: (e as Error).message,
        app: "ibkr-import", user_id: row.user_id,
      });
    }
  }

  return new Response("ok");
});
```
Note the `ibkr_id: trades[0]?.ibkr_id ?? "unknown"` is a simplification for the shadow log's per-diff granularity — refine this in Task 5 if the Phase 3 review finds it too coarse to act on (one row per account-level diff is enough to trigger a manual look, which is all shadow mode needs).

- [ ] **Step 4: Write the Deno test**

Create `supabase/functions/_shared/flex-import_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";
import { flexParseXML, computeShadowDiff } from "./flex-import.mjs";

Deno.test("flexParseXML runs against the injected xmldom DOMParser", () => {
  const xml = `<FlexQueryResponse><FlexStatements><FlexStatement>
    <Trades><Trade symbol="AAPL" assetCategory="STK" buySell="BUY"
      dateTime="20260101;103000" quantity="10" tradePrice="150" ibCommission="1"
      tradeID="t1" openCloseIndicator="O" /></Trades>
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
  const out = flexParseXML(xml, DOMParser);
  assertEquals(out.length, 1);
  assertEquals(out[0].symbol, "AAPL");
});

Deno.test("computeShadowDiff reports a trade missing from existing rows", async () => {
  const trade = { symbol: "AAPL", type: "stock", ls: "L", shares: 10,
    entryPrice: 150, entryDate: "2026-01-01", commission: 1, ibkr_id: "t1", closedShares: 0 };
  const result = await computeShadowDiff([trade], []);
  assertEquals(result.imported, 1);
});

Deno.test("computeShadowDiff reports nothing when the trade already exists", async () => {
  const trade = { symbol: "AAPL", type: "stock", ls: "L", shares: 10,
    entryPrice: 150, entryDate: "2026-01-01", commission: 1, ibkr_id: "t1", closedShares: 0, deleted: false };
  const result = await computeShadowDiff([trade], [trade]);
  assertEquals(result.imported, 0);
  assertEquals(result.updated, 0);
});
```

- [ ] **Step 5: Run the Deno tests**

```bash
deno test --allow-net --allow-env supabase/functions/_shared/flex-import_test.ts
```
Expected: all 3 pass.

- [ ] **Step 6: Add the deploy line and deploy**

In `.github/workflows/deploy.yml`, add `ibkr-import` alongside the existing `ibkr-cron`/`ibkr-alert` deploy lines (same pattern, same job).
```bash
mcp__supabase__deploy_edge_function for ibkr-import (or push to main and let CI deploy it, per this repo's existing pattern)
```

- [ ] **Step 7: Schedule the cron**

```sql
select cron.schedule('ibkr-import-shadow', '0 */6 * * *', $$
  select net.http_post(
    url := 'https://fnklrqxwyeibfptaxewf.supabase.co/functions/v1/ibkr-import',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
  );
$$);
```
Run via `mcp__supabase__apply_migration` or `execute_sql` (matches the existing `ibkr-cron` scheduling pattern — check `ibkr_sync_pg_cron` memory for the exact existing header/auth convention already in use and match it instead of guessing a new one).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/ibkr-import supabase/functions/_shared/flex-import.mjs supabase/functions/_shared/flex-import_test.ts supabase/migrations/20260923_flex_import_shadow_log.sql .github/workflows/deploy.yml
git commit -m "Add ibkr-import shadow-mode Edge Function

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Guard against shadow mode ever writing

**Files:**
- Test: `supabase/functions/_shared/flex-import_test.ts` (append)

**Interfaces:**
- Consumes: `ibkr-import/index.ts`'s source text (read directly, not imported — this is a source-level guard test, matching the existing pattern for the trade-chart's `setVisibleLogicalRange` guard per `CLAUDE.md`).

- [ ] **Step 1: Write the guard test**

Append to `supabase/functions/_shared/flex-import_test.ts`:
```ts
Deno.test("ibkr-import never writes to the trades table while in shadow mode", async () => {
  const src = await Deno.readTextFile(
    new URL("../ibkr-import/index.ts", import.meta.url),
  );
  const hasTradesWrite = /\.from\(["']trades["']\)\s*\.\s*(insert|update|upsert|delete)/.test(src);
  if (hasTradesWrite) {
    throw new Error(
      "ibkr-import writes to trades — this must stay log-only until Phase 4 cutover is explicitly approved",
    );
  }
});
```

- [ ] **Step 2: Run it and confirm it passes against the current file**

```bash
deno test --allow-net --allow-env --allow-read supabase/functions/_shared/flex-import_test.ts
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/flex-import_test.ts
git commit -m "Add a guard test: ibkr-import must stay log-only until Phase 4

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `shadow_diff_unresolved` health check

**Files:**
- Modify: `supabase/migrations/` (new migration, rebuild `data_health_check_core` from `pg_get_functiondef`, per the mandatory 2026-09-17 rule in CLAUDE.md — never reconstruct it from a migration file picked by eye)

**Interfaces:**
- Consumes: `flex_import_shadow_log` (Task 3).
- Produces: a `data_health_check()` row, surfaced the same way every other check in that function already is (nightly cron + Telegram alert on failure).

- [ ] **Step 1: Pull the current function body**

```
mcp__supabase__execute_sql: select pg_get_functiondef('public.data_health_check_core(uuid)'::regprocedure);
```

- [ ] **Step 2: Add the new check, appended to the existing `UNION ALL` chain**

```sql
  union all
  select 'shadow_diff_unresolved', count(*), 'warning'
  from flex_import_shadow_log
  where user_id = p_user_id and created_at < now() - interval '48 hours'
```
(Match the exact column names/shape the surrounding checks already use — copy the pattern from the row immediately above this one in the pulled function body rather than guessing the shape.)

- [ ] **Step 3: Apply as a migration, re-run `data_health_check()`, confirm no unrelated checks changed**

```
mcp__supabase__apply_migration with the full CREATE OR REPLACE FUNCTION body
mcp__supabase__execute_sql: select * from data_health_check();
```
Compare the row count/contents against a run from immediately before this migration — per the 2026-09-18 CLAUDE.md incident, a hand-reconstructed function body has silently dropped unrelated checks before. Any difference beyond the new `shadow_diff_unresolved` row is a bug in this task, not a coincidence.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "Add shadow_diff_unresolved health check

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Phase 3 — Review window (no code)

### Task 6: Manual review checklist

This task has no code changes. It's a gate, not a deliverable.

- [ ] Wait at least 1 week after Task 3/4 ship and the cron has run at least twice per account.
- [ ] Query `select * from flex_import_shadow_log order by created_at desc;` across all four IBKR accounts (`9f9ffff4`, `5f72e0bb`, `6f73a6c3`, `dcb5bdba`).
- [ ] For every row: cross-check against the real Flex XML the same way `broker_reconciliation_recipe` (memory) describes, and root-cause it — don't dismiss a diff without understanding why it fired.
- [ ] A diff caused by a genuine bug in `computeShadowDiff`/`_flexImportInner` gets fixed as its own task (root cause, failing test, fix, verify — per `systematic-debugging`), not patched around in `ibkr-import`.
- [ ] Gate to proceed to Phase 4: zero unresolved rows in `flex_import_shadow_log` across all four accounts for one full week with no new diffs appearing.

---

## Phase 4 — Cutover

### Task 7: Kill switch, real writes, remove the browser's write path

**Files:**
- Modify: `supabase/functions/ibkr-import/index.ts`
- Modify: `dashboard.html` (remove the `_flexImportInner` call added in Task 2's Step 4, keep only reads)
- Create: `supabase/migrations/20260923_ibkr_import_kill_switch.sql`
- Test: `supabase/functions/_shared/flex-import_test.ts` (update the Task 4 guard test)

- [ ] **Step 1: Add the kill switch column**

```sql
alter table user_settings add column if not exists ibkr_server_import_enabled boolean not null default false;
```
Apply via `mcp__supabase__apply_migration`.

- [ ] **Step 2: Update `ibkr-import/index.ts` to write for real, gated per-user**

Add a check before the shadow-log branch in the per-row loop:
```ts
const { data: settings } = await sb
  .from("user_settings")
  .select("ibkr_server_import_enabled")
  .eq("user_id", row.user_id)
  .single();
if (!settings?.ibkr_server_import_enabled) continue; // still shadow-only for this user
```
Replace the `computeShadowDiff` call with a real `_flexImportInner(trades, { db: liveDb, _sb: sb, _currentUser: { id: row.user_id }, _tradeToRow, _rowToTrade, _isDeletedImport, _dedupeTrades })` where `liveDb` is populated from the `existing` query already in the loop, and `_tradeToRow`/`_rowToTrade`/`_isDeletedImport`/`_dedupeTrades` are ported from `dashboard.html` into a small Deno-side adapter file (`supabase/functions/ibkr-import/row-mapping.ts`) — these four are row-shape/dedup helpers with no DOM dependency, safe to duplicate minimally or (preferred, consistent with the spec's single-shared-module decision) moved into `flex-import.mjs` alongside `_flexImportInner` in this task if they turn out to have no browser-only dependencies when read closely. Read `_tradeToRow`/`_rowToTrade`/`_isDeletedImport`/`_dedupeTrades` in full before choosing — do not assume.

- [ ] **Step 3: Update the Task 4 guard test to allow writes only when the kill switch check is present**

Change the guard from "no trades write at all" to "no trades write outside an `ibkr_server_import_enabled` check": read the source and assert the write call is textually preceded by a reference to `ibkr_server_import_enabled` within the same function. Keep this test — a future edit removing the gate should still fail something.

- [ ] **Step 4: Enable for one account first**

```sql
update user_settings set ibkr_server_import_enabled = true where user_id = '9f9ffff4-0936-446c-b816-410b50894e8b';
```
(davidtheking28@gmail.com — the account confirmed as the real/primary one per the `two_accounts_check_which` memory.) Watch `client_errors` and the account's `trades` table for a few days before enabling the rest.

- [ ] **Step 5: Remove the browser's write path**

In `dashboard.html`, change the `_flexImportInner` wrapper added in Task 2 Step 4 to no longer call `FlexImport._flexImportInner` — either delete the function and its call sites entirely (if nothing else needs a browser-triggered manual import), or keep a manual "force re-check" button that calls the server function via an authenticated fetch instead of importing locally. Decide based on whether the product still wants a manual sync button — this is a product call, not a technical one; ask before removing user-facing functionality.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/ibkr-import supabase/functions/_shared/flex-import_test.ts supabase/migrations/20260923_ibkr_import_kill_switch.sql dashboard.html
git commit -m "Cut over to server-side IBKR import, gated by kill switch

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

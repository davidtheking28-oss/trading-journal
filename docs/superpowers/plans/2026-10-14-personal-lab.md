# Personal Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution recommendation: implement inline in the current session; no agent delegation unless explicitly requested by the user.

**Goal:** Add a working, account-scoped 30-day personal experiment with three templates, a statistics workspace and a compact dashboard card.

**Architecture:** A lazy classic-script module owns experiment state, calculations and rendering. PostgreSQL owns experiment lifecycle, uniqueness, access control and final snapshots. Existing journal records and calculations remain authoritative; no broker execution changes.

**Tech Stack:** Existing JavaScript, HTML/CSS, Supabase PostgreSQL RPC/RLS, Node tests and Playwright. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-10-14-personal-lab-design.md`.

## Global Constraints

- ניסוי פעיל אחד לכל משתמש, גם בין מכשירים.
- תקופת השוואה: 30 הימים שלפני תחילת הניסוי.
- הגדרות ניסוי שהתחיל אינן משתנות.
- ללא AI, התראות בזמן אמת, מסך תשלום או שיתוף ציבורי.
- עברית ואנגלית, RTL/LTR, מצב כהה ובהיר, ניווט מקלדת, מצב פרטיות והסתרת סכומים.
- No real trading account tests. SQL writes are rollback-only except the explicitly scoped schema migration through Supabase MCP.
- Preserve public configuration placeholders and lazy script versioning. Do not deploy screener functions.
- Commit/push and production publication require user authorization; do not bundle unrelated files.

## Review Focus

1. A timed-out start may have committed: retry must discover the existing active experiment (Task 2/3).
2. Late broker imports and deleted trades change live denominators, but never rewrite a completed snapshot (Task 1/2).
3. Partial exits are realized activity in existing isClosed; label them as realized-result records, not fully closed positions (Task 1/4).
4. An account switch during load or mutation must immediately clear both surfaces and ignore stale responses (Task 3/5).
5. Browser dates, DST, leap days and invalid imported date strings must not move records between experiment cohorts (Task 1/2).

## File Map

Create `assets/js/personal-lab.js`: pure calculations, per-account state, RPC boundary, lifecycle and views.

Create `supabase/migrations/20261014_personal_experiments.sql`: table, indexes, policies, validation and lifecycle RPCs.

Create `tests/personal-experiments.sql`: rollback-only permission, lifecycle and snapshot tests.

Create `tests/fixtures/personal-lab-cases.json`: shared JS/SQL parity cases.

Modify `dashboard.html`: two hosts and `.lab-*` CSS only; keep existing script order.

Modify `assets/js/dashboard.js`: lazy loader, small account reset/load hooks, render hooks, relevant data invalidation and existing realtime channel subscription.

Modify `assets/js/statistics.js`: render lab before advanced statistics, independent of global stats filters.

Modify `assets/js/auth.js` and `assets/js/bootstrap.js`: invalidate lab work and clear DOM on signout/account changes.

Modify `sw.js`, `tests/harness.mjs`, `tests/logic.test.mjs`, `tests/browser.test.cjs`, `tests/fixtures/supabase-browser.js`: precache, source loading and meaningful regression coverage.

## Task 1: Pure Experiment Calculations

**Interfaces**

```js
// template: daily_limit | setup_documented | reason_documented
// asset_scope: stock | crypto; target: integer 1..10, or 100 for documentation
function labDate(value) {} // strict YYYY-MM-DD -> same string, otherwise null
function labMeasure(experiment, trades, nowDate) {}
// -> { current, baseline, daysElapsed, daysRemaining, smallSample, pendingStart }
// each cohort -> { records, activityDays, numerator, denominator, adherence,
//                 realizedRecords, net, missingIds }
```

- [ ] Add `personal-lab.js` to harness source list and write failing tests via function extraction. A one-day group with three records and target two yields numerator 0, denominator 1; an empty group yields adherence null. A setup cohort with vcp and an empty setup yields 1/2. A whitespace-only reason is missing. Invalid setup codes are missing.

```js
const result = labMeasure({template:'daily_limit', asset_scope:'stock', target:2,
  start_date:'2026-10-15', end_date:'2026-11-14'}, [
  {id:1,type:'stock',entryDate:'2026-10-15'},
  {id:2,type:'stock',entryDate:'2026-10-15'},
  {id:3,type:'stock',entryDate:'2026-10-15'}
], '2026-10-16');
assert.equal(result.current.denominator, 1);
assert.equal(result.current.numerator, 0);
```

- [ ] Run `node --test --test-name-pattern="personal lab" tests/logic.test.mjs`; expect missing-function failure before implementation.
- [ ] Implement strict date validation by parsing components and round-tripping UTC calendar values. Use UTC day arithmetic on date strings, never local midnight milliseconds divided by 86400000. Actual nowDate is computed with Intl.DateTimeFormat using the experiment's stored timezone. Cohort: start inclusive, end exclusive, excluding future entry dates after nowDate. Baseline: start minus 30 calendar days to start exclusive.
- [ ] Filter by scope, deletion and valid entry date; use existing SETUP_OPTIONS, isClosed and calcTotal. No automatic trade tagging. Deduplicate by stable trade ID only; do not merge separate broker rows by symbol/date.
- [ ] Add shared fixture cases: long 10 shares 100→110 minus fees 2 = 98; short 10 shares 100→90 minus fees 2 = 98; partial target 4 shares at110 plus exit of remaining6 at90 minus2 = -22; open row has zero realizedRecords; deleted rows are absent. Include zero/missing closedShares fallback as calcPL currently implements it.
- [ ] Assert leap-day validity, impossible dates, month/year boundaries, start/end exclusion, future entries, no baseline, unknown type and missing metadata. Test imported late rows update live output.
- [ ] Rerun focused tests and full logic suite; expected all pass. No changes to existing P&L calculations.

## Task 2: Atomic Server Persistence and Frozen Summaries

**Interfaces**

```sql
-- all return a single personal_experiments row
public.start_personal_experiment(p_template text, p_asset_scope text,
  p_target integer, p_timezone text)
public.finish_personal_experiment(p_id uuid, p_expected_updated_at timestamptz,
  p_choice text, p_note text)
public.cancel_personal_experiment(p_id uuid, p_expected_updated_at timestamptz)
-- helper returns both cohort metrics, with version=1 and computed_at
public.personal_experiment_metrics(p_id uuid)
```

- [ ] Verify remote and project URL again; inspect tables through Supabase list_tables and constraints/policies through execute_sql before DDL. Read only schema; no personal rows. The initial inspection confirmed public.trades columns and no personal_experiments table.
- [ ] Write rollback-only SQL assertions: unauthenticated RPC rejected, user B cannot select/finish A, direct inserts/updates/deletes denied, invalid template/target/timezone rejected, repeat start while active returns existing row, finish before end rejected, stale update returns PT409, cancelled/completed rows immutable. Run against an isolated fixture transaction, expecting absent-table failure before migration.
- [ ] Create table with UUID default, user FK ON DELETE CASCADE, constrained enums, target checks, timestamp defaults, date interval check, note length <=500, summary fields, and unique partial index:

```sql
create unique index personal_experiments_one_active
on public.personal_experiments(user_id) where status = 'active';
alter table public.personal_experiments enable row level security;
create policy own_experiment_read on public.personal_experiments
for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.personal_experiments from anon, authenticated;
grant select on public.personal_experiments to authenticated;
```

- [ ] Implement security-definer RPCs with `set search_path = ''`, fully qualified objects, auth.uid validation, execute revoked from public/anon and granted to authenticated. Accept only known template/scope/target; verify timezone against pg_timezone_names. Compute next local day using server now, then end=start+30. Serialize start by transaction advisory lock keyed by user UUID so duplicate requests return the active record without resetting it.
- [ ] Implement strict date helper safe for text imports; malformed dates do not throw or coerce. Implement numeric net calculation matching Task 1 fixtures, including target arrays and partial exits. Guard JSON shape; skip malformed target elements consistently with JS. Use original trade side mapping L/Long and S/Short as _rowToTrade does. The metrics helper must check ownership even though it reads other owned data.
- [ ] Finish takes row lock, checks owner/status/updated_at and stored timezone end date; computes metrics from owned trades inside the same transaction, persists snapshot and note/choice, and advances updated_at using clock_timestamp. No client-supplied financial snapshot. Cancel similarly locks/checks, preserves config and sets cancelled. Mutation cannot edit another user's record or alter config.
- [ ] Enable realtime for the table only if not already present; restrict payload through SELECT RLS. Grant minimum permissions only. Apply the saved migration with Supabase MCP after inspection, then run the regression SQL with rollback. No manual user SQL.
- [ ] Compare server metrics with the JSON fixture results from Task 1. If any parity case fails, fix before enabling summary UI; do not hide the mismatch with rounding. Verify completed metrics unchanged after an owned fixture trade changes. Verify different scopes, default/null deleted flag and malformed dates.

## Task 3: Account-Safe Loading and Mutations

**Interfaces**

```js
function loadPersonalLabFeature() {
  return loadDashboardFeature('personal-lab.js', () => typeof labRender === 'function');
}
// module entry points
async function labLoad({ force = false } = {}) {}
async function labStart(config) {}
async function labFinish(id, updatedAt, choice, note) {}
async function labCancel(id, updatedAt) {}
function labReset() {}
function labInvalidate() {}
function labRender() {}
function labRenderOverview() {}
```

- [ ] Write failing tests with deferred Supabase responses: simultaneous loads share a request only for the same user; switching user before settlement discards results; rejected saves retain config/note; successful start with a lost first response is reconciled on retry; stale summaries reload before offering another write.
- [ ] State contains captured user object, generation, read sequence, mutation revision, load/error status, rows, form draft and busy flag. Invalidate reads at both mutation start and completion. Writes include original id and updated_at; after await require same user and generation. A failed response cannot toast success.
- [ ] Select explicit experiment columns and `.eq('user_id', user.id)`, order newest first. Load latest 20 history records initially with an explicit load-more button; keep active query separate so active cannot disappear due to pagination. Dashboard fetches active only, history loads upon entering lab. Keep no experiment data in localStorage; only user-scoped dismissal preference may be local.
- [ ] Reset synchronously clears drafts, requests, rows and both hosts before another user renders. Preserve legal acknowledgement gate: no lab data loads before existing auth flow permits journal loads.
- [ ] Add account-owned realtime invalidation to the existing channel lifecycle. Refresh on visible return only when overview/statistics active; deduplicate requests and clean subscription through existing teardown. Do not refresh in background tabs.
- [ ] Add precache versioned personal-lab.js entry. Test lazy failure retry and no duplicate script request; no new blocking startup script.
- [ ] Run focused account/concurrency tests then full logic suite.

## Task 4: Real Journal UI and Local Preview

**UI contract**

```html
<section id="personal-lab" aria-labelledby="personal-lab-title"></section>
<section id="personal-lab-overview" aria-label="המעבדה האישית"></section>
```

- [ ] Add a failing browser scenario: login → statistics → choose daily-limit template → stock → target3 → review date range → start → active card → reload retains row → overview card leads back to lab.
- [ ] Render three template cards with one primary action each. Use event listeners and textContent/esc for dynamic values; no raw notes in inline event handlers. Visible loading/error/retry surfaces use role=status/alert. Preserve draft when rerendering stats filters; lab has independent scope labels.
- [ ] Add three-step inline creation form with Back/Next controls, labels, validation and review before start. Render exact next-day start/end dates in stored timezone and explain no broker blocking. No mandatory daily action or pressure to trade.
- [ ] Active screen: title and scope, day progress, numerator/denominator, baseline comparison, missing-documentation list linked to existing openModal editing, and cancel confirmation. For pending start show start date; after end show summary choice, note and save action. Empty/no data/error are distinct states.
- [ ] Final summary uses server snapshot only; shows computed timestamp and frozen-data notice. Monetary label is “תוצאה ממומשת נטו” / “Net realized result”, including rows with partial exits; show realized-record count, not fully closed-position count. Dates and percentages use locale formatting; no color-only status.
- [ ] Implement CSS via existing theme tokens: compact card header, three equal template cards on desktop, wrapping stack on tablet, clear focus ring and no letter-spacing on Hebrew. Reduced motion respected. No external decorative assets, chart library or dependency.
- [ ] Dashboard card shows one next action and short progress; user-scoped dismiss for no-experiment invitation. Privacy mode hides monetary values in lab and snapshots with existing privacy classes. In privacy mode missing-trade list follows existing symbol privacy conventions.
- [ ] Extend mocked SDK to simulate RPC-owned state, failure, conflict and delayed results. No production credentials. Start a local HTTP server using existing test server pattern and capture preview PNGs for template choice, active experiment and final summary with clearly mocked data. Keep preview helper/test fixture under tests, excluded from deployment.
- [ ] Run browser flow in Hebrew/English, light/dark, 1280×900 and 1024×768; assert no page overflow and keyboard access. Open local preview for user once working.

## Task 5: Regression, Documentation and Handoff

- [ ] Add browser cases for two users, pending network after switch, offline save/retry, two simulated clients starting simultaneously, immutable history, edit-then-return refresh, hidden-tab refresh suppression and loader failure. Inspect pageerror output; do not rely solely on DOM screenshots.
- [ ] Run required checks separately and inspect exit codes before git mutations:

```powershell
node --test tests/logic.test.mjs
npm test --prefix tests
deno test --allow-net --allow-read supabase/functions/_shared/ supabase/functions/sector-holdings/
git diff --check
```

- [ ] Run SQL regression through Supabase MCP in rollback-only transaction after verifying target; record fixture parity and authorization results without user data.
- [ ] Review migration grants, account resets, data deletion coverage and lifecycle consistency. Update project architecture docs with the module, RPC signatures and snapshot semantics; do not claim statistical significance or investment advice.
- [ ] Show preview screenshots and exact local route; describe any blocked tests honestly. Ask for live deployment only after a concrete working result exists if user has not authorized it. Commit/push only with authorization; use explicit paths and preserve unrelated local files.

## Self-Review

All three templates, independent filters, next-day 30-day interval, comparison window, sample warnings, cancellation, end review, snapshot freezing, identity protection, server uniqueness, pagination, theme/locale/privacy and deployment tests have an owning task above. The five Review Focus cases have explicit tests. The server is necessary for durable multi-device behavior; a browser-only mock is a preview and cannot be described as a finished production feature.

Status: implemented on codex/personal-lab after user approval. Local preview is available; frontend publication remains pending. Verification: 257 logic tests, 37 browser tests, 67 Edge tests and rollback-only SQL checks passed. See docs/PERSONAL-LAB.md for implementation boundaries.

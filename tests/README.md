# Tests

No build step, no dependencies. Node's built-in runner only.

```bash
node --test tests/logic.test.mjs
```

Both layers also run on their own: the suite gates every deploy (the `test` job
in `.github/workflows/deploy.yml` — a failure blocks Pages *and* the Edge
Functions), and `data_health_check()` runs nightly at 03:45 UTC via the
`data-health-alert` cron job, messaging Telegram only when a check fails.

## Layer 1 — logic (`logic.test.mjs`)

`harness.mjs` reads `dashboard.html`, pulls individual functions out of the
inline script by name, and evaluates just those against small stubs (including a
minimal `DOMParser` so `flexParseXML` can run headless). The app boots straight
into the DOM and Supabase, so importing it wholesale is not possible — this is
the way to reach the pure logic.

Two kinds of assertion:

- **behavioural** — the function is extracted and actually run
- **guard** — the function's *source* is asserted to still contain a specific
  safety condition. Used where code is welded to the DOM or Supabase and cannot
  run headless. A guard test cannot prove behaviour, only that the condition was
  not deleted. They are marked as such in the file.

Every case corresponds to a defect that reached production. Adding a test here
is the right move whenever a calculation or import bug is fixed.

**The suite is mutation-checked**: reintroducing the double-counting reduce, the
`sameSize` guard removal, the full-row write, or the dedup broker-id filter each
turn it red. If you change these areas, confirm the relevant test still fails
when the fix is reverted — a test that cannot fail is worse than no test.

## Layer 2 — data integrity (Postgres)

Layer 1 cannot see the database. `data_health_check()` covers what it misses —
lost updates, bad writes, missing RLS:

```sql
SELECT * FROM data_health_check();          -- every user
SELECT * FROM data_health_check('<uuid>');  -- one user
```

Each row is a defect class that reached production. Nonzero `failing_rows` on a
`critical` check means live data is currently wrong. Both functions live in
`supabase/migrations/20260813_data_health_checks.sql` — keep that file and the
deployed database in step when changing a check.

Related: `detect_fragmented_trades(uuid)` flags symbol/day clusters of ≥3 IBKR
rows as a re-fragmentation early warning. A nonzero result is not proof of a bug
on its own — genuine high-frequency day trading looks the same. Verify against
the raw Flex XML before acting.

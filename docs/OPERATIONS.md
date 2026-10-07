# Production rollout and recovery

## Frontend deployment

Push authorized changes to `main`. `.github/workflows/deploy.yml` gates Pages and
Edge Function deployment on the logic, browser and Deno suites. Confirm both deploy
jobs succeeded for the expected commit before checking the live site.

Pages publishes staged HTML, assets, the service worker and the shared Flex import
module. `__APP_VERSION__` is replaced with the commit hash in frontend script URLs
and service-worker precache entries. Verify the live HTML and all four scripts use
that hash and return successfully. Check desktop and mobile startup for JavaScript
errors. Authenticated write checks must use a designated test account or a transaction
that rolls back; do not create trades in a real account to test a deployment.

## Pre-rollout snapshot

The private tables ending in `_backup_20261007_pre_atomic_frontend` contain snapshots
of `trades`, `portfolios`, `investments` and `investment_holdings` immediately before
the atomic frontend rollout. They have RLS enabled, no app policies, and no access
for `anon` or `authenticated`. They contain personal data and must never be included
in the public website or exported into Git.

`tests/backup-restore.sql` restores the snapshot into temporary tables with the current
schema's defaults, check constraints and indexes. It compares every restored row and
validates account/portfolio relationships, then rolls back the entire drill.
The verified snapshot contained 716 trades, four portfolio documents, four holdings
and four portfolios. This snapshot does not replace a full Supabase project backup:
authentication, Storage objects and other applications on the shared project are
outside this drill.

For a real recovery, use the Supabase MCP tools. Preserve a fresh snapshot first,
stop the affected writes, and identify the account and portfolio to restore. Restore
portfolios before documents and holdings; maintain the original IDs and user IDs.
Review newer broker imports and trades before replacing any live rows. Test the
recovery in a rollback-only transaction and validate data health before committing
an explicitly authorized recovery. Do not run a blanket restore of the shared project.

## Existing alert pipeline

The dashboard writes save errors with `kind='inv_save'` and `app='dashboard'` to
`client_errors`. `data_health_check()` includes dashboard errors from the last seven
days in `client_errors_accumulating`; `data_health_report()` includes failing checks
in the nightly report. The active `data-health-alert` job runs at 03:45 UTC.
The existing `ibkr-health-alert` and `ibkr-confirm-alert` jobs monitor broker syncs.

`tests/monitoring.sql` inserts one synthetic save failure, verifies it reaches the
health check and report, checks active schedules, then rolls back. It deliberately
does not invoke the sender. A successful cron run means the job ran; verify outbound
delivery separately if Telegram stops receiving alerts.

On a save alert, inspect grouped error kinds, timestamps and affected app versions
before personal row contents. On a broker alert, compare the fetch/import timestamps
and shared import's shadow results before modifying any positions.

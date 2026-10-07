# Project: Trading Journal 2.0

Personal trading journal web app with Supabase authentication and per-user data.

## Project identity

- Local checkout: C:/Users/david/trading-journal/
- GitHub: davidtheking28-oss/trading-journal
- Hosting: https://davidtheking28-oss.github.io/trading-journal/
- Supabase project ref: fnklrqxwyeibfptaxewf
- Verify the checkout, Git remote and Supabase project before changing deployed resources.

## Frontend structure

- dashboard.html contains the dashboard markup, CSS and public configuration placeholders.
- assets/js/auth.js owns the Supabase client, authentication, onboarding and session state.
- assets/js/dashboard.js contains the journal, analytics, broker interfaces and shared UI helpers.
- assets/js/investments.js owns portfolios, holdings, investment calculations and save state.
- assets/js/bootstrap.js starts the app after the other deferred scripts have loaded.
- Scripts share their existing global bindings. Keep their order in dashboard.html and keep startup in bootstrap.js.
- Broker parsing/import logic is shared with the server in supabase/functions/_shared/flex-import.mjs.
- There is no frontend build step. Use a local HTTP server; file:// is unsuitable for module imports.

## Working rules

- Respond in Hebrew when the user writes in Hebrew. Keep updates brief.
- Preserve unrelated local changes. Implement only the authorized scope.
- Read the affected code before editing. Prefer const/let and async/await.
- Preserve optimistic UI behavior and show accurate save failures.
- Use existing CSS variables, RTL behavior and privacy-mode classes.
- Keep keys in server secrets; never put a service-role key in browser code or Git.
- Keep Supabase public configuration placeholders in dashboard.html; deployment injects them.
- Do not force-push or bypass hooks. Commit and push when authorized by the user.

## Investment persistence

- Save through the save_investment_portfolio RPC. Document fields, holdings and removals commit atomically.
- Pass the loaded updated_at value for optimistic concurrency; a PT409 response requires reloading.
- Bind asynchronous work to its original user, portfolio and generation. Invalidate it on account changes.
- Keep investment_holdings as the source of holdings, preserving row IDs.
- A failed save retains editable input and offers retry; only an acknowledged save clears the unsaved warning.
- Precache all frontend scripts in sw.js. Deployment replaces __APP_VERSION__ in script URLs and cache entries.

## Tests and deployment

- Logic: node --test tests/logic.test.mjs
- Browser setup: npm install --prefix tests --ignore-scripts --no-package-lock
- Browser installation: cd tests && npx playwright install chromium
- Browser tests: node --test tests/browser.test.cjs
- Browser tests load the real dashboard with mocked authentication/data boundaries; they never use live trading accounts.
- SQL regression: tests/atomic-investments.sql runs authenticated database checks and rolls back all test writes.
- Edge tests: deno test --allow-net --allow-read supabase/functions/_shared/ supabase/functions/sector-holdings/
- tests/harness.mjs loads dashboard.html plus its external scripts. Update it if script layout changes.
- CI gates both Pages and Edge Function deployments on logic, browser and Edge Function tests.
- Pages publishes only the staged public website files, assets and shared browser import module; test dependencies stay out of the website.
- The tracked pre-commit hook covers dashboard.html, assets/js/ and the logic test harness.
- Never claim a blocked or unrun test passed. Report validation limits.

## Supabase SQL

Use the Supabase MCP server for schema changes and database queries; never ask the user to paste SQL manually.
Inspect the schema first, save migrations under supabase/migrations/, then apply them with the migration tool.
Keep RLS enabled and scope every user-owned query to auth.uid()/user_id. Verify portfolio ownership as well.
Test data mutations in rollback-only transactions and do not print credentials or personal trading data.
The stock-screener shares this Supabase project: do not deploy functions named ohlc, scan-universe or daily-scan here.

## Knowledge and feedback

Personal knowledge base: C:/Users/david/.Codex/knowledge-base.md. Consult it when relevant.
Save user corrections and useful new patterns there when permissions allow.
Project-specific architecture and testing information belongs in tracked project documentation.

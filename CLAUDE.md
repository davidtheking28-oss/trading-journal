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

-- One-time deletion of an abandoned account (amitfiller2@gmail.com,
-- user_id 6f73a6c3-a154-4736-9608-aaef97761dc9): signed up 2026-05-30,
-- signed in once, never returned (110 days). IBKR sync dead since
-- 2026-06-24 (credentials already wiped, see ibkr_flex_window_orphans
-- memory). Confirmed with the app owner before running.
delete from trades_backup_20260823_u2 where user_id='6f73a6c3-a154-4736-9608-aaef97761dc9';
delete from trades_backup_20260827_partial_close where user_id='6f73a6c3-a154-4736-9608-aaef97761dc9';
delete from flex_statement_cache where user_id='6f73a6c3-a154-4736-9608-aaef97761dc9';
delete from user_settings where user_id='6f73a6c3-a154-4736-9608-aaef97761dc9';
delete from trades where user_id='6f73a6c3-a154-4736-9608-aaef97761dc9';
delete from auth.users where id='6f73a6c3-a154-4736-9608-aaef97761dc9';

-- anon and authenticated held TRUNCATE on every public table (Supabase's
-- default grants). PostgREST never exposes TRUNCATE so this wasn't reachable
-- from the browser, but TRUNCATE bypasses RLS entirely -- defense in depth,
-- found in the 2026-09-02 audit.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

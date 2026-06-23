-- Defense in depth: app_secrets / flex_sync_log / flex_sync_health are
-- service-role-only. RLS already blocks anon/authenticated reads, but revoke the
-- PostgREST API grants entirely so the secrets/log aren't even queryable. The
-- Edge Functions use the service role, which bypasses both grants and RLS.
REVOKE ALL ON public.app_secrets      FROM anon, authenticated;
REVOKE ALL ON public.flex_sync_log    FROM anon, authenticated;
REVOKE ALL ON public.flex_sync_health FROM anon, authenticated;

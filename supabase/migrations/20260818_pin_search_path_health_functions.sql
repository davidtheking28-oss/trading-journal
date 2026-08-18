-- data_health_check() and detect_fragmented_trades() were the only two public
-- functions without a pinned search_path. Neither is SECURITY DEFINER, so this
-- is hardening rather than a fix for an exposure: it stops an unqualified name
-- inside them from resolving against a caller-controlled search_path.
alter function public.data_health_check(uuid) set search_path = public;
alter function public.detect_fragmented_trades(uuid) set search_path = public;

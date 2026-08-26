-- The dashboard hides the "Trade Confirmation Query ID" field from non-admin
-- users (2026-08-26, commit 27e7db6), but flexSave() writes it through a plain
-- _saveUserSettings() call with no server-side check — a regular user could
-- still set it via devtools. This trigger makes the restriction real: any
-- attempt to set flex_confirm_query_id to non-null for a non-admin user_id is
-- rejected outright, so the UI hiding is backed by an actual server-side rule
-- instead of only hiding a button.
CREATE OR REPLACE FUNCTION public.enforce_admin_only_flex_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.flex_confirm_query_id IS NOT NULL
     AND NEW.user_id <> '9f9ffff4-0936-446c-b816-410b50894e8b'::uuid THEN
    RAISE EXCEPTION 'flex_confirm_query_id is admin-only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_admin_only_flex_confirm ON public.user_settings;
CREATE TRIGGER trg_enforce_admin_only_flex_confirm
  BEFORE INSERT OR UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_only_flex_confirm();

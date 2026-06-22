-- Bugfix: confirm-only writes to flex_statement_cache were failing with
-- "null value in column xml violates not-null constraint". A confirm upsert
-- supplies only xml_confirm/confirm_fetched_at, so the INSERT tuple left the
-- NOT NULL xml and fetched_at columns null. A cache row may legitimately hold
-- only the Trade Confirmation track, so both activity columns become nullable.
-- The frontend already guards on !!row.xml before reading fetched_at.
ALTER TABLE public.flex_statement_cache ALTER COLUMN xml        DROP NOT NULL;
ALTER TABLE public.flex_statement_cache ALTER COLUMN fetched_at DROP NOT NULL;

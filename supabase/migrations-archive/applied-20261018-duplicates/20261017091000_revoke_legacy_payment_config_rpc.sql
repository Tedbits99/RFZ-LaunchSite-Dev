-- ALREADY APPLIED to live database as: 20261018151856_20261017091000_revoke_legacy_payment_config_rpc.sql
-- Do not re-execute this original file. Kept for history only.

-- Retire execution access to the superseded 20-argument payment-config RPC.
-- Keep the function definition for compatibility investigation; the current
-- application uses the hardened 21-argument overload with p_logo_url.

DO $$
DECLARE
  v_legacy regprocedure := to_regprocedure('public.admin_upsert_payment_config(uuid,text,text,text,text,text,boolean,text,text,text,text,text,boolean,text,text[],integer,integer,integer,text,text)');
BEGIN
  IF v_legacy IS NULL THEN
    RAISE EXCEPTION 'Expected legacy admin_upsert_payment_config 20-argument overload is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.oid = v_legacy::oid
      AND n.nspname = 'public'
      AND p.proname = 'admin_upsert_payment_config'
      AND p.pronargs = 20
      AND p.pronargdefaults = 20
  ) THEN
    RAISE EXCEPTION 'Unexpected legacy admin_upsert_payment_config signature or defaults';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_upsert_payment_config(
  uuid, text, text, text, text, text, boolean,
  text, text, text, text, text, boolean, text,
  text[], integer, integer, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;

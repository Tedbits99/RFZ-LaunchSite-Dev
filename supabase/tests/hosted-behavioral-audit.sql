-- Read-only hosted Gate B assertions. This file is executed only by the
-- trusted main-branch workflow with transaction-scoped role/JWT contexts.
-- It deliberately does not call order, payment, supplier, wallet, email,
-- webhook, or reconciliation mutations.

BEGIN;

DO $$
DECLARE
  sensitive_table text;
  admin_function text;
BEGIN
  IF has_table_privilege('anon', 'public.admins', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_ANON_ADMINS_TABLE_SELECT';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.admins', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_AUTHENTICATED_ADMINS_TABLE_SELECT_MISSING';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.admins', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_SERVICE_ROLE_ADMINS_TABLE_SELECT_MISSING';
  END IF;

  FOREACH sensitive_table IN ARRAY ARRAY[
    'customer_profiles', 'orders', 'payment_submissions',
    'payment_transactions', 'refunds', 'supplier_credentials',
    'supplier_transactions', 'wallets'
  ] LOOP
    IF to_regclass('public.' || sensitive_table) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = sensitive_table
           AND c.relrowsecurity
       ) THEN
      RAISE EXCEPTION 'HOSTED_RLS_MISSING:%', sensitive_table;
    END IF;
  END LOOP;

  FOREACH admin_function IN ARRAY ARRAY[
    'public.admin_get_all_games()',
    'public.admin_get_all_payment_config()',
    'public.admin_get_games_with_package_counts()',
    'public.admin_change_order_status(uuid,text,text,text)',
    'public.admin_delete_payment_config(uuid)',
    'public.admin_set_game_active(uuid,boolean)',
    'public.verify_payment(uuid,text,text,text,text)'
  ] LOOP
    IF has_function_privilege('anon', admin_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'HOSTED_ANON_ADMIN_EXECUTE:%', admin_function;
    END IF;
  END LOOP;

  IF to_regprocedure('public.finalize_supplier_reconciliation(uuid,text,text,text)') IS NOT NULL
     AND has_function_privilege('authenticated', 'public.finalize_supplier_reconciliation(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HOSTED_AUTHENTICATED_RECONCILIATION_EXECUTE';
  END IF;
END $$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

DO $$
DECLARE
  n bigint;
BEGIN
  IF public.is_admin() THEN
    RAISE EXCEPTION 'HOSTED_ANON_IS_ADMIN';
  END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.customer_profiles;
    IF n <> 0 THEN RAISE EXCEPTION 'HOSTED_ANON_CUSTOMER_PROFILE_READ'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.orders;
    IF n <> 0 THEN RAISE EXCEPTION 'HOSTED_ANON_ORDER_READ'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_get_all_games();
    RAISE EXCEPTION 'HOSTED_ANON_ADMIN_RPC_EXECUTED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000099"}', true);

DO $$
DECLARE
  n bigint;
BEGIN
  IF public.is_admin() THEN
    RAISE EXCEPTION 'HOSTED_FAKE_CLAIM_IS_ADMIN';
  END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.customer_profiles;
    IF n <> 0 THEN RAISE EXCEPTION 'HOSTED_FAKE_CLAIM_PROFILE_READ'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.orders;
    IF n <> 0 THEN RAISE EXCEPTION 'HOSTED_FAKE_CLAIM_ORDER_READ'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_get_all_games();
    RAISE EXCEPTION 'HOSTED_NONADMIN_ADMIN_RPC_EXECUTED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;
ROLLBACK;

SELECT 'HOSTED_BEHAVIORAL_AUDIT_PASS' AS result;

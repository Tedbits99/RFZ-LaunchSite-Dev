\set ON_ERROR_STOP on

-- This file is intentionally executed only against a disposable local Supabase
-- database by scripts/test-local-database-security.sh. It never contains or
-- requests production connection settings.

BEGIN;

CREATE TEMP TABLE security_test_ids (
  admin_user uuid NOT NULL,
  game_id uuid NOT NULL,
  package_id uuid NOT NULL,
  order_id uuid NOT NULL
);

INSERT INTO security_test_ids VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- Synthetic fixtures only. The local migration chain owns these tables.
INSERT INTO public.admins (id, email, name, role, is_active)
SELECT admin_user, 'security-test-admin@example.invalid', 'Security Test Admin', 'SUPER_ADMIN', true
FROM security_test_ids
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
SELECT game_id, 'security-test-game', 'Security Test Game', 'TEST', 'Disposable fixture', 'Test', 'PHP', true, 999
FROM security_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
SELECT package_id, game_id, 'Security Test Package', 'SECURITY-TEST-PACKAGE', '1', 1, 999
FROM security_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method, status
)
SELECT order_id, 'SECURITY-TEST-ORDER', 'security-test@example.invalid', 'Security Test',
       game_id, package_id,
       jsonb_build_object('__rfz_order_access_hash', repeat('a', 64)),
       1, 0, 0, 1, 'manual', 'PENDING'
FROM security_test_ids
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_capability_count integer;
  v_token_hash text;
  v_deferrable boolean;
  v_initially_deferred boolean;
BEGIN
  SELECT count(*), min(token_hash)
  INTO v_capability_count, v_token_hash
  FROM public.guest_order_access
  WHERE order_id = '00000000-0000-0000-0000-000000000004';

  IF v_capability_count <> 1
     OR v_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'guest order capability was not created with the required scoped hash';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = '00000000-0000-0000-0000-000000000004'
      AND player_inputs ? '__rfz_order_access_hash'
  ) THEN
    RAISE EXCEPTION 'internal guest capability hash was persisted in player_inputs';
  END IF;

  SELECT condeferrable, condeferred
  INTO v_deferrable, v_initially_deferred
  FROM pg_constraint
  WHERE conrelid = 'public.guest_order_access'::regclass
    AND conname = 'guest_order_access_order_id_fkey';

  IF v_deferrable IS DISTINCT FROM true
     OR v_initially_deferred IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'guest order capability foreign key is not initially deferred';
  END IF;
END $$;

-- A malformed capability is rejected before a guest order can be created.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, reference, email, customer_name, game_id, package_id, player_inputs,
      subtotal_cents, discount_cents, fee_cents, total_cents, payment_method, status
    ) VALUES (
      '00000000-0000-0000-0000-000000000005', 'SECURITY-TEST-INVALID-CAPABILITY',
      'security-test@example.invalid', 'Security Test',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003', '{}'::jsonb,
      1, 0, 0, 1, 'manual', 'PENDING'
    );
    RAISE EXCEPTION 'order without a capability unexpectedly inserted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ORDER_ACCESS_CAPABILITY_REQUIRED' THEN
      RAISE;
    END IF;
  END;
END $$;

-- The deferred FK must not leave a capability behind when a later order
-- constraint rejects the parent insert.
DO $$
DECLARE
  v_capability_count integer;
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, reference, email, customer_name, game_id, package_id, player_inputs,
      subtotal_cents, discount_cents, fee_cents, total_cents, payment_method, status
    ) VALUES (
      '00000000-0000-0000-0000-000000000006', 'SECURITY-TEST-ROLLBACK',
      'security-test@example.invalid', 'Security Test',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      jsonb_build_object('__rfz_order_access_hash', repeat('b', 64)),
      1, 0, 0, 1, 'manual', 'NOT-A-VALID-ORDER-STATUS'
    );
    RAISE EXCEPTION 'invalid order unexpectedly inserted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*) INTO v_capability_count
  FROM public.guest_order_access
  WHERE order_id = '00000000-0000-0000-0000-000000000006';

  IF v_capability_count <> 0 THEN
    RAISE EXCEPTION 'failed order insert left a guest capability behind';
  END IF;
END $$;

-- The migration must remove implicit PUBLIC execution and explicit anonymous
-- execution for privileged functions. Anonymous and authenticated grants are
-- checked separately because an explicit grant can hide a PUBLIC revocation.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_get_all_games()',
    'public.admin_set_game_active(uuid,boolean)',
    'public.admin_get_games_with_package_counts()',
    'public.admin_get_all_payment_config()',
    'public.admin_upsert_payment_config(uuid,text,text,text,text,text,boolean,text,text,text,text,text,boolean,text,text[],integer,integer,integer,text,text,text)',
    'public.admin_delete_payment_config(uuid)',
    'public.admin_change_order_status(uuid,text,text,text)',
    'public.get_supplier_credential(text,text)',
    'public.set_supplier_credential(text,text,text)'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anonymous role still has EXECUTE on %', fn;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_supplier_credential(text,text)',
    'public.set_supplier_credential(text,text,text)'
  ] LOOP
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated role still has EXECUTE on supplier credential function %', fn;
    END IF;
  END LOOP;
END $$;

-- Both overloads must exist with their intended signatures. The legacy
-- overload is retained only for compatibility investigation and must have no
-- effective EXECUTE privilege, including inherited PUBLIC access. The current
-- overload remains executable by authenticated/service roles but enforces the
-- database-side operator check.
DO $$
DECLARE
  legacy_fn text := 'public.admin_upsert_payment_config(uuid,text,text,text,text,text,boolean,text,text,text,text,text,boolean,text,text[],integer,integer,integer,text,text)';
  current_fn text := 'public.admin_upsert_payment_config(uuid,text,text,text,text,text,boolean,text,text,text,text,text,boolean,text,text[],integer,integer,integer,text,text,text)';
  legacy_oid oid;
  current_oid oid;
  legacy_owner text;
  current_owner text;
BEGIN
  IF to_regprocedure(legacy_fn) IS NULL OR to_regprocedure(current_fn) IS NULL THEN
    RAISE EXCEPTION 'Expected payment-config overloads are missing';
  END IF;

  legacy_oid := to_regprocedure(legacy_fn)::oid;
  current_oid := to_regprocedure(current_fn)::oid;

  SELECT pg_get_userbyid(p.proowner)
  INTO legacy_owner
  FROM pg_proc p
  WHERE p.oid = legacy_oid;

  SELECT pg_get_userbyid(p.proowner)
  INTO current_owner
  FROM pg_proc p
  WHERE p.oid = current_oid;

  IF legacy_owner IN ('anon', 'authenticated') OR current_owner IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Payment-config overload has an untrusted owner';
  END IF;

  IF has_function_privilege('anon', legacy_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', legacy_oid, 'EXECUTE')
     OR has_function_privilege('service_role', legacy_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy payment-config overload remains executable by a restricted role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = legacy_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Legacy payment-config overload retains PUBLIC EXECUTE';
  END IF;

  IF has_function_privilege('anon', current_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', current_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', current_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hardened payment-config overload has unexpected EXECUTE privileges';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = current_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Hardened payment-config overload retains PUBLIC EXECUTE';
  END IF;
END $$;

-- PostgreSQL cannot unambiguously execute the legacy overload with 20
-- arguments because the hardened 21-argument overload has a defaulted
-- p_logo_url and shares the first 20 input types. Explicit casts do not change
-- that overload resolution. The exact legacy OID ACL assertions above are
-- therefore the security test for that overload; they fail CI if EXECUTE is
-- restored to anon, authenticated, service_role, or PUBLIC. Runtime tests
-- below target the unambiguous hardened 21-argument overload.

-- Anonymous callers must fail at the privilege boundary, not merely return no
-- rows. The role and claim are set exactly as PostgREST sets them.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.admin_get_all_games();
    RAISE EXCEPTION 'anonymous admin_get_all_games unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.admin_upsert_payment_config(
      p_method_key => 'hardened-anon-test',
      p_display_name => 'Hardened Anon Test',
      p_logo_url => NULL::text
    );
    RAISE EXCEPTION 'anonymous hardened payment-config mutation unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_delete_payment_config(
      '00000000-0000-0000-0000-000000000099'
    );
    RAISE EXCEPTION 'anonymous payment-config deletion unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- An authenticated non-admin must have the SQL EXECUTE grant but fail the
-- database-side operator check.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000099"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.admin_get_all_games();
    RAISE EXCEPTION 'non-admin admin_get_all_games unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM NOT IN ('FORBIDDEN', 'permission denied for function admin_get_all_games') THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_change_order_status(
      '00000000-0000-0000-0000-000000000004', 'WAITING_PAYMENT',
      'security-test', 'unauthorized fixture'
    );
    RAISE EXCEPTION 'non-admin admin_change_order_status unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM NOT IN ('FORBIDDEN', 'permission denied for function admin_change_order_status') THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_upsert_payment_config(
      p_method_key => 'hardened-user-test',
      p_display_name => 'Hardened User Test',
      p_logo_url => NULL::text
    );
    RAISE EXCEPTION 'non-admin hardened payment-config mutation unexpectedly executed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM 1 FROM public.admin_delete_payment_config(
      '00000000-0000-0000-0000-000000000099'
    );
    RAISE EXCEPTION 'non-admin payment-config deletion unexpectedly executed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'FORBIDDEN' THEN
      RAISE;
    END IF;
  END;
END $$;
RESET ROLE;

-- An authenticated admin retains the intended operator path.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);
DO $$
DECLARE
  v_count integer;
  v_id uuid;
  v_success boolean;
BEGIN
  SELECT count(*) INTO v_count FROM public.admin_get_all_games();
  IF v_count < 1 THEN
    RAISE EXCEPTION 'authorized admin game read assertion failed';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_get_games_with_package_counts();
  IF v_count < 1 THEN
    RAISE EXCEPTION 'authorized admin game-count read assertion failed';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_get_all_payment_config();
  IF v_count < 1 THEN
    RAISE EXCEPTION 'authorized admin payment-config read assertion failed';
  END IF;

  SELECT id INTO v_id
  FROM public.admin_set_game_active(
    '00000000-0000-0000-0000-000000000002', false
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'authorized admin game mutation assertion failed';
  END IF;

  SELECT out_id INTO v_id
  FROM public.admin_upsert_payment_config(
    p_method_key => 'security-test-method',
    p_display_name => 'Security Test Method',
    p_logo_url => NULL::text
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'authorized admin payment-config mutation assertion failed';
  END IF;

  SELECT out_success INTO v_success
  FROM public.admin_delete_payment_config('00000000-0000-0000-0000-000000000099');
  IF v_success IS NOT FALSE THEN
    RAISE EXCEPTION 'authorized admin missing-delete assertion failed';
  END IF;
END $$;
RESET ROLE;

-- service_role is trusted by is_payment_operator() and remains usable for
-- server-side operations. The claim is set explicitly to mirror Supabase JWT.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
  v_count integer;
  v_status text;
BEGIN
  SELECT count(*) INTO v_count FROM public.admin_get_all_games();
  IF v_count < 1 THEN
    RAISE EXCEPTION 'service-role game read assertion failed';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_get_all_payment_config();
  IF v_count < 1 THEN
    RAISE EXCEPTION 'service-role payment-config read assertion failed';
  END IF;

  SELECT out_status INTO v_status
  FROM public.admin_change_order_status(
    '00000000-0000-0000-0000-000000000004', 'WAITING_PAYMENT',
    'security-test', 'disposable fixture'
  );
  IF v_status <> 'WAITING_PAYMENT' THEN
    RAISE EXCEPTION 'service-role order status assertion failed';
  END IF;
END $$;
RESET ROLE;

-- Public catalog reads remain available through the normal table/RLS path.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.games WHERE is_active = true;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'public catalog read assertion failed';
  END IF;
END $$;
RESET ROLE;

-- Verify SECURITY DEFINER and locked search_path for the newly hardened RPCs.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regprocedure('public.admin_delete_payment_config(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Expected admin_delete_payment_config(uuid) is missing';
  END IF;

  FOR r IN
    SELECT p.oid::regprocedure AS signature,
           p.prosecdef AS security_definer,
           p.proconfig AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_get_all_games', 'admin_set_game_active',
        'admin_get_games_with_package_counts', 'admin_get_all_payment_config',
        'admin_upsert_payment_config', 'admin_delete_payment_config'
      )
  LOOP
    IF NOT r.security_definer THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER', r.signature;
    END IF;
    IF NOT EXISTS (
         SELECT 1
         FROM unnest(COALESCE(r.config, ARRAY[]::text[])) AS settings(setting)
         WHERE setting = 'search_path=public'
       )
       OR EXISTS (
         SELECT 1
         FROM unnest(COALESCE(r.config, ARRAY[]::text[])) AS settings(setting)
         WHERE setting LIKE 'search_path=%'
           AND setting <> 'search_path=public'
       ) THEN
      RAISE EXCEPTION '% does not lock search_path to exactly public (proconfig=%)', r.signature, r.config;
    END IF;
    IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = r.signature::regprocedure)) IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION '% is owned by an untrusted API role', r.signature;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF has_schema_privilege('anon', 'public', 'CREATE')
     OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'An untrusted API role can CREATE objects in public';
  END IF;
END $$;

ROLLBACK;

-- The wrapper runs this file in a fresh database and then resets it again. A
-- second reset is the retry/idempotency check; no destructive rollback grant
-- is provided because restoring PUBLIC execution would recreate the risk.

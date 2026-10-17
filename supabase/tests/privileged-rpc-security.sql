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
       game_id, package_id, '{}'::jsonb, 1, 0, 0, 1, 'manual', 'PENDING'
FROM security_test_ids
ON CONFLICT (id) DO NOTHING;

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
END $$;
RESET ROLE;

-- An authenticated admin retains the intended operator path.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000001"}', true);
SELECT count(*) >= 1 AS admin_game_read_ok FROM public.admin_get_all_games();
SELECT count(*) >= 1 AS admin_game_count_read_ok FROM public.admin_get_games_with_package_counts();
SELECT count(*) >= 1 AS admin_payment_config_read_ok FROM public.admin_get_all_payment_config();
SELECT id IS NOT NULL AS admin_game_mutation_ok
FROM public.admin_set_game_active(
  '00000000-0000-0000-0000-000000000002', false
);
SELECT out_id IS NOT NULL AS admin_payment_config_mutation_ok
FROM public.admin_upsert_payment_config(
  p_method_key => 'security-test-method',
  p_display_name => 'Security Test Method'
);
SELECT out_success IS FALSE AS admin_payment_config_delete_missing_ok
FROM public.admin_delete_payment_config('00000000-0000-0000-0000-000000000099');
RESET ROLE;

-- service_role is trusted by is_payment_operator() and remains usable for
-- server-side operations. The claim is set explicitly to mirror Supabase JWT.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT count(*) >= 1 AS service_game_read_ok FROM public.admin_get_all_games();
SELECT count(*) >= 1 AS service_payment_config_read_ok FROM public.admin_get_all_payment_config();
SELECT out_status = 'WAITING_PAYMENT' AS service_order_status_ok
FROM public.admin_change_order_status(
  '00000000-0000-0000-0000-000000000004', 'WAITING_PAYMENT',
  'security-test', 'disposable fixture'
);
RESET ROLE;

-- Public catalog reads remain available through the normal table/RLS path.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT count(*) >= 1 AS public_catalog_read_ok
FROM public.games WHERE is_active = true;
RESET ROLE;

-- Verify SECURITY DEFINER and locked search_path for the newly hardened RPCs.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature,
           p.prosecdef AS security_definer,
           pg_get_functiondef(p.oid) AS definition
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
    IF r.definition NOT ILIKE '%search_path = public%' THEN
      RAISE EXCEPTION '% does not lock search_path to public', r.signature;
    END IF;
    IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = r.signature::regprocedure)) IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION '% is owned by an untrusted API role', r.signature;
    END IF;
  END LOOP;
END $$;

ROLLBACK;

-- The wrapper runs this file in a fresh database and then resets it again. A
-- second reset is the retry/idempotency check; no destructive rollback grant
-- is provided because restoring PUBLIC execution would recreate the risk.

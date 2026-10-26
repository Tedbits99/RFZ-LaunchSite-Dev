\set ON_ERROR_STOP on

-- Assertions unique to the legacy-to-current upgrade runner. This file runs
-- after the 11-migration hosted baseline and the reviewed post-baseline
-- sequence, never against the hosted project.

DO $$
DECLARE
  v_policy_count integer;
  v_search_path text[];
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 99 THEN
    RAISE EXCEPTION 'UPGRADE_MIGRATION_COUNT_INVALID';
  END IF;

  IF to_regclass('public.order_email_outbox') IS NULL
     OR to_regclass('public.customer_profiles') IS NULL
     OR to_regclass('public.supplier_transactions') IS NULL THEN
    RAISE EXCEPTION 'UPGRADE_REQUIRED_OBJECT_MISSING';
  END IF;

  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('payment_submissions', 'voucher_usages', 'vouchers');
  IF v_policy_count < 3 THEN
    RAISE EXCEPTION 'UPGRADE_LEGACY_RLS_POLICIES_MISSING';
  END IF;

  IF has_function_privilege(
       'anon', 'public.admin_change_order_status(uuid,text,text,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'UPGRADE_LEGACY_ADMIN_RPC_ANON_PUBLIC';
  END IF;
  IF has_function_privilege(
       'authenticated', 'public.admin_change_order_status(uuid,text,text,text)', 'EXECUTE'
     ) IS NOT TRUE
     OR has_function_privilege(
       'service_role', 'public.admin_change_order_status(uuid,text,text,text)', 'EXECUTE'
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'UPGRADE_OPERATOR_ADMIN_RPC_GRANT_MISSING';
  END IF;

  SELECT p.proconfig INTO v_search_path
  FROM pg_proc AS p
  WHERE p.oid = 'public.admin_change_order_status(uuid,text,text,text)'::regprocedure;
  IF v_search_path IS NULL OR NOT ('search_path=public' = ANY (v_search_path)) THEN
    RAISE EXCEPTION 'UPGRADE_ADMIN_RPC_SEARCH_PATH_INVALID';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL
     OR to_regclass('net._http_response') IS NOT NULL THEN
    RAISE EXCEPTION 'UPGRADE_EXTERNAL_SCHEDULER_ENABLED';
  END IF;
END $$;

-- Synthetic idempotency and failure-recovery fixtures. No provider, SMTP,
-- supplier, payment, or outbound HTTP call is made by these assertions.
BEGIN;

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
VALUES ('00000000-0000-0000-0000-000000000701', 'upgrade-test-game', 'Upgrade Test Game', 'UPG', 'Disposable fixture', 'Test', 'PHP', true, 2701)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
VALUES ('00000000-0000-0000-0000-000000000702', '00000000-0000-0000-0000-000000000701', 'Upgrade Test Package', 'UPGRADE-TEST-PACKAGE', '1', 1, 2701)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
VALUES ('00000000-0000-0000-0000-000000000703', 'Upgrade Test Supplier', 'fazercards', 'custom', true, 'sandbox')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
VALUES (
  '00000000-0000-0000-0000-000000000704', 'UPGRADE-TEST-ORDER',
  'upgrade-test@example.invalid', 'Upgrade Test',
  '00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000702',
  jsonb_build_object('__rfz_order_access_hash', repeat('c', 64)),
  1, 0, 0, 1, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES (
  '00000000-0000-0000-0000-000000000705',
  '00000000-0000-0000-0000-000000000704',
  '00000000-0000-0000-0000-000000000703',
  'upgrade-test-idempotency-key', 'create_order', 'pending', 'upgrade-test-reference'
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000705', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome <> 'applied' THEN
    RAISE EXCEPTION 'UPGRADE_SYNTHETIC_COMPLETION_FAILED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000705', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome <> 'already-finalized' THEN
    RAISE EXCEPTION 'UPGRADE_IDEMPOTENCY_FAILED';
  END IF;
END $$;

ROLLBACK;

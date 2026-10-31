\set ON_ERROR_STOP on

-- Disposable local Supabase regression tests. No production settings or
-- provider credentials are used here.

BEGIN;

CREATE TEMP TABLE reconciliation_test_ids (
  supplier_id uuid NOT NULL,
  other_supplier_id uuid NOT NULL,
  game_id uuid NOT NULL,
  package_id uuid NOT NULL,
  completed_order_id uuid NOT NULL,
  completed_tx_id uuid NOT NULL,
  failed_order_id uuid NOT NULL,
  failed_tx_id uuid NOT NULL,
  rollback_order_id uuid NOT NULL,
  rollback_tx_id uuid NOT NULL
);

INSERT INTO reconciliation_test_ids VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104',
  '00000000-0000-0000-0000-000000000105',
  '00000000-0000-0000-0000-000000000106',
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000108',
  '00000000-0000-0000-0000-000000000109',
  '00000000-0000-0000-0000-000000000110'
);

INSERT INTO public.games AS existing_game (
  id, slug, name, short_name, description, region, currency, is_active, sort_order, catalog_status, published_at
)
SELECT game_id, 'reconciliation-test-game', 'Reconciliation Test Game', 'RECON', 'Disposable fixture', 'Test', 'PHP', true, 2001,
       'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
FROM reconciliation_test_ids
ON CONFLICT (id) DO UPDATE SET
  is_active = true, catalog_status = 'PUBLISHED',
  published_at = COALESCE(existing_game.published_at, EXCLUDED.published_at);

INSERT INTO public.packages AS existing_package (
  id, game_id, name, sku, amount, price_cents, sort_order, is_active, catalog_status, published_at
)
SELECT package_id, game_id, 'Reconciliation Test Package', 'RECON-TEST-PACKAGE', '1', 1, 2001, true,
       'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
FROM reconciliation_test_ids
ON CONFLICT (id) DO UPDATE SET
  is_active = true, catalog_status = 'PUBLISHED',
  published_at = COALESCE(existing_package.published_at, EXCLUDED.published_at);

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
SELECT supplier_id, 'FazerCards Security Test', 'fazercards', 'custom', true, 'sandbox'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
SELECT other_supplier_id, 'Other Security Test Supplier', 'other-test-supplier', 'generic', true, 'sandbox'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
SELECT completed_order_id, 'RECON-COMPLETE', 'recon@example.invalid', 'Recon Test', game_id, package_id,
       jsonb_build_object('__rfz_order_access_hash', repeat('a', 64)), 1, 0, 0, 1, 'manual',
       'PROCESSING', 'VERIFIED', 'PROCESSING'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
SELECT failed_order_id, 'RECON-FAILED', 'recon@example.invalid', 'Recon Test', game_id, package_id,
       jsonb_build_object('__rfz_order_access_hash', repeat('b', 64)), 1, 0, 0, 1, 'manual',
       'PROCESSING', 'VERIFIED', 'PROCESSING'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
SELECT rollback_order_id, 'RECON-ROLLBACK', 'recon@example.invalid', 'Recon Test', game_id, package_id,
       jsonb_build_object('__rfz_order_access_hash', repeat('c', 64)), 1, 0, 0, 1, 'manual',
       'PROCESSING', 'VERIFIED', 'PROCESSING'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
SELECT completed_tx_id, completed_order_id, supplier_id, 'recon-complete-key', 'create_order', 'pending', 'recon-complete-ref'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
SELECT failed_tx_id, failed_order_id, supplier_id, 'recon-failed-key', 'create_order', 'submitted', 'recon-failed-ref'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
SELECT rollback_tx_id, rollback_order_id, supplier_id, 'recon-rollback-key', 'create_order', 'pending', 'recon-rollback-ref'
FROM reconciliation_test_ids
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'completed', 'auto-reconciliation', NULL
  );
  IF r.out_outcome <> 'applied' OR r.out_transaction_status <> 'success' OR r.out_fulfillment_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'successful reconciliation did not apply atomically';
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'completed', 'auto-reconciliation', NULL
  );
  IF r.out_outcome <> 'already-finalized' THEN
    RAISE EXCEPTION 'repeated reconciliation was not idempotent';
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000108', 'failed', 'auto-reconciliation', 'supplier rejected test order'
  );
  IF r.out_outcome <> 'applied' OR r.out_transaction_status <> 'failed' OR r.out_fulfillment_status <> 'FAILED' THEN
    RAISE EXCEPTION 'explicit supplier failure did not apply atomically';
  END IF;
END $$;

UPDATE public.orders
SET payment_status = 'UNPAID'
WHERE id = '00000000-0000-0000-0000-000000000109';

DO $$
DECLARE r record; v_tx_status text;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000110', 'completed', 'auto-reconciliation', NULL
  );
  SELECT status INTO v_tx_status FROM public.supplier_transactions
  WHERE id = '00000000-0000-0000-0000-000000000110';
  IF r.out_outcome <> 'inconsistent' OR v_tx_status <> 'pending' THEN
    RAISE EXCEPTION 'invalid order state did not remain safely retryable';
  END IF;
END $$;

UPDATE public.orders
SET payment_status = 'VERIFIED'
WHERE id = '00000000-0000-0000-0000-000000000109';

DO $$
DECLARE r record; v_tx_status text;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000110', 'failed', 'auto-reconciliation', NULL
  );
  SELECT status INTO v_tx_status FROM public.supplier_transactions
  WHERE id = '00000000-0000-0000-0000-000000000110';
  IF r.out_outcome <> 'retryable' OR v_tx_status <> 'pending' THEN
    RAISE EXCEPTION 'ambiguous failure did not remain retryable';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.reject_reconciliation_timeline()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'intentional timeline failure';
END;
$function$;

CREATE TRIGGER reconciliation_timeline_failure
BEFORE INSERT ON public.order_timeline
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_reconciliation_timeline();

DO $$
BEGIN
  BEGIN
    PERFORM public.finalize_supplier_reconciliation(
      '00000000-0000-0000-0000-000000000110', 'completed', 'auto-reconciliation', NULL
    );
    RAISE EXCEPTION 'timeline failure did not abort reconciliation';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'intentional timeline failure' THEN RAISE; END IF;
  END;
END $$;

DROP TRIGGER reconciliation_timeline_failure ON public.order_timeline;

DO $$
DECLARE v_tx_status text; v_fulfillment_status text;
BEGIN
  SELECT status INTO v_tx_status FROM public.supplier_transactions
  WHERE id = '00000000-0000-0000-0000-000000000110';
  SELECT fulfillment_status INTO v_fulfillment_status FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000109';
  IF v_tx_status <> 'pending' OR v_fulfillment_status <> 'PROCESSING' THEN
    RAISE EXCEPTION 'timeline failure did not roll back transaction and order';
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'failed', 'auto-reconciliation', 'conflicting result'
  );
  IF r.out_outcome <> 'inconsistent' THEN
    RAISE EXCEPTION 'terminal transaction regressed or accepted conflicting outcome';
  END IF;
END $$;

DO $$
DECLARE v_count integer; r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'completed', 'auto-reconciliation', NULL
  );
  SELECT count(*) INTO v_count FROM public.order_timeline
  WHERE order_id = '00000000-0000-0000-0000-000000000105' AND status = 'COMPLETED';
  IF r.out_outcome <> 'already-finalized' OR v_count <> 1 THEN
    RAISE EXCEPTION 'duplicate finalization or timeline event detected';
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'processing', 'auto-reconciliation', NULL
  );
  IF r.out_outcome <> 'inconsistent' THEN
    RAISE EXCEPTION 'invalid outcome was accepted';
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000106', 'completed', 'auto-reconciliation', NULL
  );
  IF r.out_outcome <> 'already-finalized' THEN
    RAISE EXCEPTION 'terminal state was not preserved';
  END IF;
END $$;

DO $$
DECLARE v_fulfillment_status text;
BEGIN
  UPDATE public.orders SET fulfillment_status = 'PROCESSING', status = 'PROCESSING'
  WHERE id = '00000000-0000-0000-0000-000000000109';
  SELECT fulfillment_status INTO v_fulfillment_status FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000109';
  IF v_fulfillment_status <> 'PROCESSING' THEN RAISE EXCEPTION 'fixture reset failed'; END IF;
END $$;

DO $$
DECLARE v_tx_id uuid; r record;
BEGIN
  INSERT INTO public.supplier_transactions (order_id, supplier_id, idempotency_key, action, status, supplier_reference)
  VALUES (
    '00000000-0000-0000-0000-000000000109',
    '00000000-0000-0000-0000-000000000102',
    'recon-other-supplier-key', 'create_order', 'pending', 'other-ref'
  ) RETURNING id INTO v_tx_id;
  SELECT * INTO r FROM public.finalize_supplier_reconciliation(v_tx_id, 'completed', 'auto-reconciliation', NULL);
  IF r.out_outcome <> 'inconsistent' THEN RAISE EXCEPTION 'non-FazerCards supplier was accepted'; END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.finalize_supplier_reconciliation(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finalize_supplier_reconciliation(uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.finalize_supplier_reconciliation(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'reconciliation RPC grants are unsafe';
  END IF;
END $$;

ROLLBACK;

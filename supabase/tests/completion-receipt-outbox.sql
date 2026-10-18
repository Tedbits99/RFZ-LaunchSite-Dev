\set ON_ERROR_STOP on

-- Disposable-only completion receipt outbox assertions. The fixture uses
-- synthetic orders and never calls an email provider.

BEGIN;

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000402', 'receipt-outbox-game', 'Receipt Outbox Game', 'ROG',
  'Disposable fixture', 'Test', 'PHP', true, 2402
);

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000402',
  'Receipt Outbox Package', 'RECEIPT-OUTBOX-PACKAGE', '1', 12345, 2402
);

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
VALUES (
  '00000000-0000-0000-0000-000000000401', 'FazerCards Receipt Test', 'fazercards', 'custom', true, 'sandbox'
);

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status
)
VALUES
  (
    '00000000-0000-0000-0000-000000000404', 'RECEIPT-COMPLETE-1',
    'receipt-complete-1@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('1', 64)),
    12345, 0, 0, 12345, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000406', 'RECEIPT-PROCESSING',
    'receipt-processing@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('2', 64)),
    12345, 0, 0, 12345, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000408', 'RECEIPT-FAILED',
    'receipt-failed@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('3', 64)),
    12345, 0, 0, 12345, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000410', 'RECEIPT-PAYMENT-ONLY',
    'receipt-payment-only@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('4', 64)),
    12345, 0, 0, 12345, 'manual', 'PAYMENT_VERIFIED', 'VERIFIED', 'NOT_STARTED'
  ),
  (
    '00000000-0000-0000-0000-000000000412', 'RECEIPT-CANCELLED',
    'receipt-cancelled@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('5', 64)),
    12345, 0, 0, 12345, 'manual', 'CANCELLED', 'REFUNDED', 'NOT_STARTED'
  ),
  (
    '00000000-0000-0000-0000-000000000414', 'RECEIPT-REFUNDED',
    'receipt-refunded@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('6', 64)),
    12345, 0, 0, 12345, 'manual', 'REFUNDED', 'REFUNDED', 'NOT_STARTED'
  ),
  (
    '00000000-0000-0000-0000-000000000416', 'RECEIPT-EXPIRED',
    'receipt-expired@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('7', 64)),
    12345, 0, 0, 12345, 'manual', 'EXPIRED', 'FAILED', 'NOT_STARTED'
  ),
  (
    '00000000-0000-0000-0000-000000000418', 'RECEIPT-COMPLETE-2',
    'receipt-complete-2@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('8', 64)),
    12345, 0, 0, 12345, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000420', 'RECEIPT-ROLLBACK',
    'receipt-rollback@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('9', 64)),
    12345, 0, 0, 12345, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING'
  ),
  (
    '00000000-0000-0000-0000-000000000422', 'RECEIPT-UNVERIFIED',
    'receipt-unverified@example.invalid', 'Receipt Test',
    '00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000403',
    jsonb_build_object('__rfz_order_access_hash', repeat('a', 64)),
    12345, 0, 0, 12345, 'manual', 'WAITING_PAYMENT', 'UNPAID', 'NOT_STARTED'
  );

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES
  ('00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-1', 'create_order', 'pending', 'receipt-supplier-1'),
  ('00000000-0000-0000-0000-000000000407', '00000000-0000-0000-0000-000000000406', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-2', 'create_order', 'pending', 'receipt-supplier-2'),
  ('00000000-0000-0000-0000-000000000409', '00000000-0000-0000-0000-000000000408', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-3', 'create_order', 'submitted', 'receipt-supplier-3'),
  ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000410', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-4', 'create_order', 'pending', 'receipt-supplier-4'),
  ('00000000-0000-0000-0000-000000000413', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-5', 'create_order', 'pending', 'receipt-supplier-5'),
  ('00000000-0000-0000-0000-000000000415', '00000000-0000-0000-0000-000000000414', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-6', 'create_order', 'pending', 'receipt-supplier-6'),
  ('00000000-0000-0000-0000-000000000417', '00000000-0000-0000-0000-000000000416', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-7', 'create_order', 'pending', 'receipt-supplier-7'),
  ('00000000-0000-0000-0000-000000000419', '00000000-0000-0000-0000-000000000418', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-8', 'create_order', 'pending', 'receipt-supplier-8'),
  ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000420', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-9', 'create_order', 'pending', 'receipt-supplier-9'),
  ('00000000-0000-0000-0000-000000000423', '00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000401', 'receipt-outbox-key-10', 'create_order', 'pending', 'receipt-supplier-10');

DO $$
DECLARE
  v_result record;
  v_count integer;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000405', 'completed', 'auto-reconciliation', NULL
  );

  IF v_result.out_outcome <> 'applied'
     OR v_result.out_transaction_status <> 'success'
     OR v_result.out_fulfillment_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_COMPLETION_NOT_APPLIED';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000404'
    AND template = 'completion_receipt';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_OUTBOX_ROW_INVALID';
  END IF;

  SELECT receipt_snapshot
  INTO v_snapshot
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000404'
    AND template = 'completion_receipt';

  IF v_snapshot->>'reference' <> 'RECEIPT-COMPLETE-1'
     OR (v_snapshot->>'total_cents')::integer <> 12345
     OR v_snapshot->>'payment_method' <> 'manual' THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_OUTBOX_ROW_INVALID';
  END IF;

  IF v_snapshot ?| ARRAY['capability_hash', 'supplier_id', 'supplier_reference', 'secret'] THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_SENSITIVE_DATA_STORED';
  END IF;
END $$;

DO $$
DECLARE
  v_result record;
  v_count integer;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000405', 'completed', 'auto-reconciliation', NULL
  );
  SELECT count(*) INTO v_count
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000404'
    AND template = 'completion_receipt';
  IF v_result.out_outcome <> 'already-finalized' OR v_count <> 1 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_DUPLICATE_CREATED';
  END IF;
END $$;

DO $$
DECLARE
  v_result record;
  v_count integer;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000419', 'completed', 'auto-reconciliation', NULL
  );
  SELECT count(*) INTO v_count
  FROM public.order_email_outbox
  WHERE template = 'completion_receipt';
  IF v_result.out_outcome <> 'applied' OR v_count <> 2 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_DISTINCT_ORDER_NOT_ENQUEUED';
  END IF;
END $$;

DO $$
DECLARE
  v_result record;
  v_count integer;
BEGIN
  -- A supplier PROCESSING result has no reconciliation call and no receipt.
  SELECT count(*) INTO v_count
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000406';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_PROCESSING_ENQUEUED';
  END IF;

  -- A supplier-reported failure is finalized but never produces a success receipt.
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000409', 'failed', 'auto-reconciliation', 'synthetic failure'
  );
  IF v_result.out_outcome <> 'applied' OR v_result.out_fulfillment_status <> 'FAILED' THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_FAILED_STATE_NOT_FINALIZED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000411', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome NOT IN ('inconsistent', 'retryable') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_PAYMENT_ONLY_ACCEPTED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000413', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome NOT IN ('inconsistent', 'retryable') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_CANCELLED_ACCEPTED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000415', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome NOT IN ('inconsistent', 'retryable') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_REFUNDED_ACCEPTED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000417', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome NOT IN ('inconsistent', 'retryable') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_EXPIRED_ACCEPTED';
  END IF;

  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000423', 'completed', 'auto-reconciliation', NULL
  );
  IF v_result.out_outcome NOT IN ('inconsistent', 'retryable') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_UNVERIFIED_ACCEPTED';
  END IF;

  SELECT count(*) INTO v_count FROM public.order_email_outbox;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_INELIGIBLE_STATE_ENQUEUED';
  END IF;
END $$;

DO $$
BEGIN
  CREATE OR REPLACE FUNCTION pg_temp.reject_completion_receipt_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $function$
  BEGIN
    RAISE EXCEPTION 'intentional completion outbox failure';
  END;
  $function$;

  CREATE TRIGGER completion_receipt_outbox_failure
  BEFORE INSERT ON public.order_email_outbox
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_completion_receipt_outbox();

  BEGIN
    PERFORM public.finalize_supplier_reconciliation(
      '00000000-0000-0000-0000-000000000421', 'completed', 'auto-reconciliation', NULL
    );
    RAISE EXCEPTION 'COMPLETION_RECEIPT_INSERT_FAILURE_NOT_PROPAGATED';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'intentional completion outbox failure' THEN
      RAISE;
    END IF;
  END;

  DROP TRIGGER completion_receipt_outbox_failure ON public.order_email_outbox;
  DROP FUNCTION pg_temp.reject_completion_receipt_outbox();
END $$;

DO $$
DECLARE
  v_tx_status text;
  v_fulfillment_status text;
  v_order_status text;
  v_timeline_count integer;
  v_outbox_count integer;
BEGIN
  SELECT status INTO v_tx_status
  FROM public.supplier_transactions
  WHERE id = '00000000-0000-0000-0000-000000000421';
  SELECT fulfillment_status, status
  INTO v_fulfillment_status, v_order_status
  FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000420';
  SELECT count(*) INTO v_timeline_count
  FROM public.order_timeline
  WHERE order_id = '00000000-0000-0000-0000-000000000420'
    AND status = 'COMPLETED';
  SELECT count(*) INTO v_outbox_count
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000420';

  IF v_tx_status <> 'pending'
     OR v_fulfillment_status <> 'PROCESSING'
     OR v_order_status <> 'PROCESSING'
     OR v_timeline_count <> 0
     OR v_outbox_count <> 0 THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_INSERT_FAILURE_DID_NOT_ROLL_BACK';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_email_outbox'::regclass)
     OR has_table_privilege('anon', 'public.order_email_outbox', 'SELECT')
     OR has_table_privilege('authenticated', 'public.order_email_outbox', 'SELECT')
     OR has_table_privilege('anon', 'public.order_email_outbox', 'INSERT')
     OR has_table_privilege('authenticated', 'public.order_email_outbox', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.order_email_outbox', 'SELECT')
     OR has_table_privilege('service_role', 'public.order_email_outbox', 'INSERT')
     OR has_column_privilege('service_role', 'public.order_email_outbox', 'status', 'UPDATE')
     OR has_column_privilege('service_role', 'public.order_email_outbox', 'attempt_count', 'UPDATE')
     OR has_column_privilege('service_role', 'public.order_email_outbox', 'recipient_email', 'UPDATE') THEN
    RAISE EXCEPTION 'COMPLETION_RECEIPT_OUTBOX_PRIVILEGES_INVALID';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.order_email_outbox;
    RAISE EXCEPTION 'COMPLETION_RECEIPT_ANON_READ_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.order_email_outbox;
    RAISE EXCEPTION 'COMPLETION_RECEIPT_AUTHENTICATED_READ_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.order_email_outbox (order_id, template, recipient_email)
    VALUES ('00000000-0000-0000-0000-000000000404', 'completion_receipt', 'forbidden@example.invalid');
    RAISE EXCEPTION 'COMPLETION_RECEIPT_SERVICE_ROLE_INSERT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.order_email_outbox
    SET status = 'sent'
    WHERE order_id = '00000000-0000-0000-0000-000000000404'
      AND template = 'completion_receipt';
    RAISE EXCEPTION 'COMPLETION_RECEIPT_SERVICE_ROLE_DIRECT_UPDATE_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

-- Direct complete_fulfillment(..., 'COMPLETED') remains covered by the
-- existing fulfillment-completion-guard.sql test, which runs in this harness.

ROLLBACK;

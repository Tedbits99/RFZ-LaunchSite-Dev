\set ON_ERROR_STOP on

-- Disposable-only authoritative completion-receipt data contract assertions.
BEGIN;

INSERT INTO public.games (
  id, slug, name, short_name, description, region, currency, is_active, sort_order, catalog_status, published_at
)
VALUES (
  '00000000-0000-0000-0000-000000000502', 'receipt-contract-game', 'Contract Game', 'CG',
  'Disposable fixture', 'Test', 'PHP', true, 2502, 'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
);

INSERT INTO public.packages (
  id, game_id, name, sku, amount, price_cents, sort_order, is_active, catalog_status, published_at
)
VALUES (
  '00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000502',
  'Contract Package', 'RECEIPT-CONTRACT-PACKAGE', '1', 23456, 2502, true,
  'PUBLISHED', '2026-01-01T00:00:00Z'::timestamptz
);

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
VALUES (
  '00000000-0000-0000-0000-000000000501', 'FazerCards Receipt Contract Test',
  'fazercards', 'custom', true, 'sandbox'
);

-- Explicit quantity represents the supported one-package storefront order.
INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status, quantity
)
VALUES (
  '00000000-0000-0000-0000-000000000504', 'RECEIPT-CONTRACT-1',
  'receipt-contract@example.invalid', 'Receipt Contract Test',
  '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503',
  jsonb_build_object('user_id', '123456789', 'server_id', '9999', '__rfz_order_access_hash', repeat('a', 64)),
  23456, 0, 0, 23456, 'gcash', 'PROCESSING', 'VERIFIED', 'PROCESSING', 1
);

DO $$
DECLARE v_quantity integer;
BEGIN
  SELECT quantity INTO v_quantity FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000504';
  IF v_quantity <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_NEW_ORDER_QUANTITY_INVALID';
  END IF;
END $$;

DO $$
DECLARE v_state text; v_constraint text;
BEGIN
  BEGIN
    INSERT INTO public.orders (
      id, reference, email, customer_name, game_id, package_id, player_inputs,
      subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
      status, payment_status, fulfillment_status, quantity
    )
    VALUES (
      '00000000-0000-0000-0000-000000000508', 'RECEIPT-CONTRACT-INVALID-QUANTITY',
      'receipt-invalid-quantity@example.invalid', 'Receipt Contract Test',
      '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503',
      jsonb_build_object('__rfz_order_access_hash', repeat('c', 64)), 23456, 0, 0, 23456, 'manual',
      'PROCESSING', 'VERIFIED', 'PROCESSING', 2
    );
    RAISE EXCEPTION 'RECEIPT_CONTRACT_INVALID_QUANTITY_ACCEPTED';
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS
      v_state = RETURNED_SQLSTATE,
      v_constraint = CONSTRAINT_NAME;
    IF NOT (
      (v_state = 'P0001' AND SQLERRM = 'ORDER_QUANTITY_UNSUPPORTED')
      OR (v_state = '23514' AND v_constraint = 'orders_quantity_single_package_check')
    ) THEN
      RAISE;
    END IF;
  END;
END $$;

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES (
  '00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000504',
  '00000000-0000-0000-0000-000000000501', 'receipt-contract-key-1',
  'create_order', 'pending', 'receipt-contract-supplier-1'
);

DO $$
DECLARE v_result record; v_outbox record; v_count integer;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000505', 'completed', 'auto-reconciliation', NULL
  );

  SELECT count(*) INTO v_count FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000504'
    AND template = 'completion_receipt';
  SELECT * INTO v_outbox FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000504'
    AND template = 'completion_receipt';

  IF v_result.out_outcome <> 'applied' OR v_count <> 1
     OR v_outbox.status <> 'pending'
     OR v_outbox.recipient_email <> 'receipt-contract@example.invalid'
     OR v_outbox.receipt_snapshot->>'reference' <> 'RECEIPT-CONTRACT-1'
     OR (v_outbox.receipt_snapshot->>'total_cents')::integer <> 23456
     OR v_outbox.receipt_snapshot->>'payment_method' <> 'gcash'
     OR v_outbox.receipt_snapshot->>'game_name' <> 'Contract Game'
     OR v_outbox.receipt_snapshot->>'package_name' <> 'Contract Package'
     OR (v_outbox.receipt_snapshot->>'quantity')::integer <> 1
     OR v_outbox.receipt_snapshot->>'masked_player_identifier' <> '*****6789' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_SNAPSHOT_INVALID';
  END IF;

  IF v_outbox.receipt_snapshot::text LIKE '%123456789%'
     OR v_outbox.receipt_snapshot::text LIKE '%__rfz_order_access_hash%'
     OR v_outbox.receipt_snapshot::text LIKE '%receipt-contract-supplier-1%' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_SENSITIVE_DATA_STORED';
  END IF;
END $$;

-- Catalog edits after completion cannot alter the persisted snapshot.
UPDATE public.games SET name = 'Renamed Contract Game'
WHERE id = '00000000-0000-0000-0000-000000000502';
UPDATE public.packages SET name = 'Renamed Contract Package'
WHERE id = '00000000-0000-0000-0000-000000000503';

DO $$
DECLARE v_snapshot jsonb;
BEGIN
  SELECT receipt_snapshot INTO v_snapshot FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000504'
    AND template = 'completion_receipt';
  IF v_snapshot->>'game_name' <> 'Contract Game'
     OR v_snapshot->>'package_name' <> 'Contract Package' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_SNAPSHOT_NOT_IMMUTABLE';
  END IF;
END $$;

-- A legacy order retains unknown quantity and is completed without reversing
-- fulfillment; its receipt is quarantined rather than fabricated.
INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status, quantity
)
VALUES (
  '00000000-0000-0000-0000-000000000506', 'RECEIPT-CONTRACT-LEGACY',
  'receipt-legacy@example.invalid', 'Receipt Legacy Test',
  '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503',
  jsonb_build_object('user_id', '987654321', '__rfz_order_access_hash', repeat('b', 64)),
  23456, 0, 0, 23456, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING', NULL
);
-- The insert above follows the supported guest fixture path.  Only the
-- quantity is then cleared to model a pre-contract historical row; ownership
-- capability validation remains active and the trigger-stripped capability is
-- preserved in guest_order_access rather than player_inputs.
UPDATE public.orders
SET quantity = NULL
WHERE id = '00000000-0000-0000-0000-000000000506';
INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES (
  '00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000506',
  '00000000-0000-0000-0000-000000000501', 'receipt-contract-key-2',
  'create_order', 'pending', 'receipt-contract-supplier-2'
);

DO $$
DECLARE v_result record; v_status text; v_fulfillment text;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000507', 'completed', 'auto-reconciliation', NULL
  );
  SELECT status, fulfillment_status INTO v_status, v_fulfillment
  FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000506';
  IF v_result.out_outcome <> 'applied' OR v_status <> 'COMPLETED'
     OR v_fulfillment <> 'COMPLETED' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_LEGACY_COMPLETION_REVERSED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_email_outbox
    WHERE order_id = '00000000-0000-0000-0000-000000000506'
      AND status = 'dead_letter'
      AND last_error = 'Receipt quantity unavailable for legacy order'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_LEGACY_ORDER_NOT_QUARANTINED';
  END IF;
END $$;

-- Quantity remains unknown for the explicitly simulated legacy row.
DO $$
DECLARE v_quantity integer;
BEGIN
  SELECT quantity INTO v_quantity FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000506';
  IF v_quantity IS NOT NULL THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_LEGACY_QUANTITY_WAS_BACKFILLED';
  END IF;
END $$;

-- Reconciliation is idempotent after quarantine; it must not create a second
-- receipt or alter the original dead-letter evidence.
DO $$
DECLARE v_result record; v_count integer; v_error text;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000507', 'completed', 'auto-reconciliation', NULL
  );
  SELECT count(*), max(last_error) INTO v_count, v_error
  FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000506'
    AND template = 'completion_receipt';
  IF v_result.out_outcome <> 'already-finalized'
     OR v_count <> 1
     OR v_error <> 'Receipt quantity unavailable for legacy order' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_LEGACY_QUARANTINE_NOT_IDEMPOTENT';
  END IF;
END $$;

-- A malformed legacy recipient is quarantined without reversing completion.
INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status, quantity
)
VALUES (
  '00000000-0000-0000-0000-000000000509', 'RECEIPT-CONTRACT-NO-EMAIL',
  'receipt-no-email@example.invalid', 'Receipt Recipient Test',
  '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503',
  jsonb_build_object('__rfz_order_access_hash', repeat('d', 64)),
  23456, 0, 0, 23456, 'manual', 'PROCESSING', 'VERIFIED', 'PROCESSING', 1
);
UPDATE public.orders SET email = ''
WHERE id = '00000000-0000-0000-0000-000000000509';
INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES (
  '00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-000000000509',
  '00000000-0000-0000-0000-000000000501', 'receipt-contract-key-3',
  'create_order', 'pending', 'receipt-contract-supplier-3'
);

DO $$
DECLARE v_result record; v_status text; v_fulfillment text;
BEGIN
  SELECT * INTO v_result
  FROM public.finalize_supplier_reconciliation(
    '00000000-0000-0000-0000-000000000510', 'completed', 'auto-reconciliation', NULL
  );
  SELECT status, fulfillment_status INTO v_status, v_fulfillment
  FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000509';
  IF v_result.out_outcome <> 'applied' OR v_status <> 'COMPLETED'
     OR v_fulfillment <> 'COMPLETED' THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_MISSING_RECIPIENT_REVERSED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_email_outbox
    WHERE order_id = '00000000-0000-0000-0000-000000000509'
      AND status = 'dead_letter'
      AND recipient_email IS NULL
      AND last_error = 'Receipt recipient unavailable'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_CONTRACT_MISSING_RECIPIENT_NOT_QUARANTINED';
  END IF;
END $$;

ROLLBACK;

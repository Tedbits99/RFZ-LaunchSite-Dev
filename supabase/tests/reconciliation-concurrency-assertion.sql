\set ON_ERROR_STOP on

DO $$
DECLARE v_tx_status text; v_order_status text; v_timeline_count integer; v_outbox_count integer;
BEGIN
  SELECT status INTO v_tx_status FROM public.supplier_transactions
  WHERE id = '00000000-0000-0000-0000-000000000205';
  SELECT fulfillment_status INTO v_order_status FROM public.orders
  WHERE id = '00000000-0000-0000-0000-000000000204';
  SELECT count(*) INTO v_timeline_count FROM public.order_timeline
  WHERE order_id = '00000000-0000-0000-0000-000000000204' AND status = 'COMPLETED';
  SELECT count(*) INTO v_outbox_count FROM public.order_email_outbox
  WHERE order_id = '00000000-0000-0000-0000-000000000204'
    AND template = 'completion_receipt';

  IF v_tx_status <> 'success' OR v_order_status <> 'COMPLETED'
     OR v_timeline_count <> 1 OR v_outbox_count <> 1 THEN
    RAISE EXCEPTION 'concurrent reconciliation did not finalize exactly once';
  END IF;
END $$;

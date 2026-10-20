-- Prevent direct completion through the generic fulfillment transition RPC.
-- Supplier-confirmed completion remains exclusively in
-- finalize_supplier_reconciliation().

CREATE OR REPLACE FUNCTION public.complete_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_actor_email text DEFAULT 'fulfillment_system',
  p_note text DEFAULT ''
)
RETURNS TABLE(out_id uuid, out_order_status text, out_fulfillment_status text, out_transitioned boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_fulfillment text;
  v_payment_status text;
  v_transitioned boolean := false;
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- COMPLETED requires a terminal supplier result. The dedicated
  -- finalize_supplier_reconciliation RPC is the only completion boundary.
  IF p_fulfillment_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETED_REQUIRES_SUPPLIER_CONFIRMATION';
  END IF;

  SELECT o.fulfillment_status, o.payment_status INTO v_current_fulfillment, v_payment_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_fulfillment IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_payment_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_VERIFIED';
  END IF;

  IF v_current_fulfillment = 'COMPLETED' AND p_fulfillment_status IN ('PROCESSING', 'FAILED', 'NOT_STARTED') THEN
    RAISE EXCEPTION 'FULFILLMENT_ALREADY_COMPLETED';
  END IF;

  IF v_current_fulfillment = 'PROCESSING' AND p_fulfillment_status = 'PROCESSING' THEN
    RETURN QUERY SELECT p_order_id, 'PROCESSING', 'PROCESSING', false;
    RETURN;
  END IF;

  IF v_current_fulfillment = 'FAILED' AND p_fulfillment_status = 'FAILED' THEN
    RETURN QUERY SELECT p_order_id, 'FULFILLMENT_FAILED', 'FAILED', false;
    RETURN;
  END IF;

  IF v_current_fulfillment <> p_fulfillment_status THEN
    v_transitioned := true;
    UPDATE public.orders
    SET fulfillment_status = p_fulfillment_status,
        status = CASE
          WHEN p_fulfillment_status = 'COMPLETED' THEN 'COMPLETED'
          WHEN p_fulfillment_status = 'PROCESSING' THEN 'PROCESSING'
          WHEN p_fulfillment_status = 'FAILED' THEN 'FULFILLMENT_FAILED'
          WHEN p_fulfillment_status = 'NOT_STARTED' THEN 'PAYMENT_VERIFIED'
          ELSE status
        END,
        updated_at = now()
    WHERE id = p_order_id;

    INSERT INTO public.order_timeline (order_id, status, actor_email, note)
    VALUES (p_order_id, p_fulfillment_status, p_actor_email, p_note);
  END IF;

  RETURN QUERY
  SELECT p_order_id,
    CASE
      WHEN p_fulfillment_status = 'COMPLETED' THEN 'COMPLETED'
      WHEN p_fulfillment_status = 'PROCESSING' THEN 'PROCESSING'
      WHEN p_fulfillment_status = 'FAILED' THEN 'FULFILLMENT_FAILED'
      WHEN p_fulfillment_status = 'NOT_STARTED' THEN 'PAYMENT_VERIFIED'
      ELSE 'PAYMENT_VERIFIED'
    END,
    p_fulfillment_status,
    v_transitioned;
END;
$$;

-- Preserve the existing effective grants: authenticated may invoke the
-- operator-guarded transition RPC; PUBLIC and anon may not.
REVOKE EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text)
  TO authenticated;

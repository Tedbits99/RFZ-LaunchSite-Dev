/*
# Fix admin_change_order_status RPC — ambiguous column reference

The function's output column is named "status", which conflicts with the
orders.status column inside the function body. Qualify the column reference
explicitly to resolve the ambiguity.
*/

CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (id uuid, status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status text;
  v_is_valid_transition boolean := false;
BEGIN
  -- Load the current status (qualify column name to avoid ambiguity with output param)
  SELECT o.status INTO v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Same status = no-op (just add timeline note)
  IF v_current_status = p_new_status THEN
    v_is_valid_transition := true;
  ELSE
    v_is_valid_transition := CASE
      WHEN v_current_status = 'WAITING_PAYMENT' AND p_new_status IN ('PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PENDING' AND p_new_status IN ('WAITING_PAYMENT', 'PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PAYMENT_PENDING' AND p_new_status IN ('WAITING_PAYMENT', 'PAID', 'CANCELLED') THEN true
      WHEN v_current_status = 'PAID' AND p_new_status IN ('PROCESSING', 'CANCELLED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'PROCESSING' AND p_new_status IN ('COMPLETED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'COMPLETED' AND p_new_status IN ('DELIVERED', 'REFUND_PENDING') THEN true
      WHEN v_current_status = 'DELIVERED' AND p_new_status IN ('REFUND_PENDING') THEN true
      WHEN v_current_status = 'REFUND_PENDING' AND p_new_status IN ('REFUNDED') THEN true
      ELSE false
    END;
  END IF;

  IF NOT v_is_valid_transition THEN
    RAISE EXCEPTION 'INVALID_TRANSITION';
  END IF;

  -- Update the order
  UPDATE public.orders
  SET status = p_new_status, updated_at = now()
  WHERE id = p_order_id;

  -- Insert timeline entry
  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  -- Return the updated row
  RETURN QUERY
  SELECT p_order_id, p_new_status, now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_order_status TO anon, authenticated;
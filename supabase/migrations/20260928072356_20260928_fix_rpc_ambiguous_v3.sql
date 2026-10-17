/*
# Fix admin_change_order_status RPC — rename output params to avoid ambiguity

The OUT parameters (id, status, updated_at) conflict with orders table columns.
Rename them to out_id, out_status, out_updated_at. Must DROP first since return
type changes.
*/

DROP FUNCTION IF EXISTS public.admin_change_order_status(uuid, text, text, text);

CREATE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (out_id uuid, out_status text, out_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_status text;
  v_is_valid_transition boolean := false;
BEGIN
  SELECT o.status INTO v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

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

  UPDATE public.orders
  SET status = p_new_status, updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  RETURN QUERY
  SELECT p_order_id, p_new_status, now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO anon, authenticated;

/*
# Fix admin_change_order_status RPC

The previous version had an ambiguous column reference: PL/pgSQL variable `status`
conflicted with `orders.status` column. This fixes it by using a distinct variable name.
*/

CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_allowed text[];
BEGIN
  SELECT orders.status INTO v_current_status FROM orders WHERE orders.id = p_order_id;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  v_allowed := CASE v_current_status
    WHEN 'WAITING_PAYMENT' THEN ARRAY['PAID','CANCELLED','REFUND_PENDING']
    WHEN 'PAID' THEN ARRAY['PROCESSING','CANCELLED','REFUND_PENDING']
    WHEN 'PROCESSING' THEN ARRAY['COMPLETED','CANCELLED','REFUND_PENDING']
    WHEN 'COMPLETED' THEN ARRAY['DELIVERED','REFUND_PENDING']
    WHEN 'DELIVERED' THEN ARRAY['REFUND_PENDING']
    WHEN 'REFUND_PENDING' THEN ARRAY['REFUNDED']
    WHEN 'REFUNDED' THEN ARRAY[]::text[]
    WHEN 'CANCELLED' THEN ARRAY[]::text[]
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_new_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION:%->%', v_current_status, p_new_status;
  END IF;

  UPDATE orders SET status = p_new_status, updated_at = now() WHERE orders.id = p_order_id;

  INSERT INTO order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  RETURN QUERY SELECT p_order_id, p_new_status;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO anon, authenticated;

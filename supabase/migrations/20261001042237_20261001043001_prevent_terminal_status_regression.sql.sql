-- Prevent transitioning FROM COMPLETED or REFUNDED back to other statuses
-- COMPLETED can only be left via the fulfillment system (complete_fulfillment RPC)
-- REFUNDED is a terminal state

CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE(out_id uuid, out_status text, out_updated_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status text;
BEGIN
  SELECT o.status INTO v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- COMPLETED can only be set by the fulfillment system, not manually
  IF p_new_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETED_NOT_ALLOWED_MANUALLY';
  END IF;

  -- Prevent transitioning FROM terminal states back to non-terminal
  IF v_current_status IN ('COMPLETED', 'REFUNDED') AND p_new_status NOT IN ('REFUND_PENDING', 'REFUNDED') THEN
    RAISE EXCEPTION 'INVALID_TRANSITION_FROM_TERMINAL';
  END IF;

  IF v_current_status <> p_new_status THEN
    UPDATE public.orders
    SET status = p_new_status, updated_at = now()
    WHERE id = p_order_id;
  END IF;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, p_new_status, p_actor_email, p_note);

  RETURN QUERY
  SELECT p_order_id, p_new_status, now();
END;
$function$;
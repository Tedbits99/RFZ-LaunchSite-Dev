/*
# Atomic Fulfillment Claim via complete_fulfillment RPC

## Purpose
Replace the broken advisory lock approach with an atomic claim using the
existing complete_fulfillment RPC's SELECT ... FOR UPDATE row lock.

The RPC now returns out_transitioned boolean indicating whether THIS call
actually changed the fulfillment_status. This lets the caller know if it
was the one that claimed the order.

## How it works
1. startFulfillment calls complete_fulfillment with PROCESSING.
2. The RPC does SELECT ... FOR UPDATE — two concurrent calls serialize on the row.
3. First call sees NOT_STARTED, transitions to PROCESSING, returns out_transitioned=true.
4. Second call sees PROCESSING (after first commits), returns out_transitioned=false.
5. startFulfillment checks out_transitioned — if false, it aborts without calling the supplier.

## Security
- No new tables or columns.
- SECURITY DEFINER, callable by authenticated.
*/

DROP FUNCTION IF EXISTS public.complete_fulfillment(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.complete_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_actor_email text DEFAULT 'fulfillment_system',
  p_note text DEFAULT ''
)
RETURNS TABLE(out_id uuid, out_order_status text, out_fulfillment_status text, out_transitioned boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fulfillment text;
  v_payment_status text;
  v_transitioned boolean := false;
BEGIN
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

  -- Guard: cannot re-start a COMPLETED order
  IF v_current_fulfillment = 'COMPLETED' AND p_fulfillment_status IN ('PROCESSING', 'FAILED', 'NOT_STARTED') THEN
    RAISE EXCEPTION 'FULFILLMENT_ALREADY_COMPLETED';
  END IF;

  -- Idempotent: PROCESSING -> PROCESSING (no state change, no timeline entry)
  IF v_current_fulfillment = 'PROCESSING' AND p_fulfillment_status = 'PROCESSING' THEN
    RETURN QUERY SELECT p_order_id, 'PROCESSING', 'PROCESSING', false;
    RETURN;
  END IF;

  -- Idempotent: FAILED -> FAILED
  IF v_current_fulfillment = 'FAILED' AND p_fulfillment_status = 'FAILED' THEN
    RETURN QUERY SELECT p_order_id, 'FULFILLMENT_FAILED', 'FAILED', false;
    RETURN;
  END IF;

  -- Only write if the status actually changes
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
$function$;

GRANT EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text) TO authenticated;

-- Drop the broken advisory lock RPC
DROP FUNCTION IF EXISTS public.try_fulfillment_lock(uuid);

/*
# Guard complete_fulfillment Against Invalid State Transitions

## Purpose
The complete_fulfillment RPC currently accepts any status transition
unconditionally. This creates two race conditions:

1. If two concurrent requests both call startFulfillment, both can set
   fulfillment_status = PROCESSING. The second call overwrites the first,
   creating duplicate timeline entries and potentially overwriting a
   FAILED status set by a concurrent retry.

2. A retry-fulfillment request could set fulfillment_status back to
   NOT_STARTED (via the retry route's direct update) while a concurrent
   pollFulfillmentStatus sets it to COMPLETED. The COMPLETED wins, but
   the retry has already called the supplier API — creating a duplicate.

This migration adds a guard: complete_fulfillment now refuses to
transition from a terminal state (COMPLETED or FAILED) to a non-terminal
state (PROCESSING or NOT_STARTED). It also refuses to set PROCESSING
if the order is already in PROCESSING (prevents double-start).

Allowed transitions after this change:
  NOT_STARTED → PROCESSING     (start fulfillment)
  PROCESSING → COMPLETED        (poll success)
  PROCESSING → FAILED            (poll failure / all suppliers fail)
  FAILED → PROCESSING            (retry after failure — explicit override)
  COMPLETED → COMPLETED          (idempotent re-confirm, no-op)

Disallowed transitions:
  COMPLETED → PROCESSING         (cannot re-start a completed order)
  COMPLETED → FAILED             (cannot fail a completed order)
  PROCESSING → PROCESSING        (cannot double-start)

The retry-fulfillment route handles FAILED → PROCESSING by first
resetting to NOT_STARTED via a direct update, then calling
startFulfillment which sets PROCESSING — this path is unaffected.

## Security
- No new tables or columns.
- SECURITY DEFINER, callable by authenticated.
*/

CREATE OR REPLACE FUNCTION public.complete_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_actor_email text DEFAULT 'fulfillment_system',
  p_note text DEFAULT ''
)
RETURNS TABLE(out_id uuid, out_order_status text, out_fulfillment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_fulfillment text;
  v_payment_status text;
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

  -- Guard against invalid transitions:
  -- 1. Cannot re-start a COMPLETED order (COMPLETED → PROCESSING or FAILED)
  IF v_current_fulfillment = 'COMPLETED' AND p_fulfillment_status IN ('PROCESSING', 'FAILED', 'NOT_STARTED') THEN
    RAISE EXCEPTION 'FULFILLMENT_ALREADY_COMPLETED';
  END IF;

  -- 2. Cannot double-start (PROCESSING → PROCESSING)
  IF v_current_fulfillment = 'PROCESSING' AND p_fulfillment_status = 'PROCESSING' THEN
    -- Idempotent: return current state without writing a duplicate timeline entry
    RETURN QUERY
    SELECT p_order_id, 'PROCESSING', 'PROCESSING';
    RETURN;
  END IF;

  -- 3. Cannot fail an already FAILED order (idempotent)
  IF v_current_fulfillment = 'FAILED' AND p_fulfillment_status = 'FAILED' THEN
    RETURN QUERY
    SELECT p_order_id, 'FULFILLMENT_FAILED', 'FAILED';
    RETURN;
  END IF;

  -- Update fulfillment status
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

  RETURN QUERY
  SELECT p_order_id,
    CASE
      WHEN p_fulfillment_status = 'COMPLETED' THEN 'COMPLETED'
      WHEN p_fulfillment_status = 'PROCESSING' THEN 'PROCESSING'
      WHEN p_fulfillment_status = 'FAILED' THEN 'FULFILLMENT_FAILED'
      WHEN p_fulfillment_status = 'NOT_STARTED' THEN 'PAYMENT_VERIFIED'
      ELSE 'PAYMENT_VERIFIED'
    END,
    p_fulfillment_status;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text) TO authenticated;

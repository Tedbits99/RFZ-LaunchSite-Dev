/*
# Update submit_payment to set payment_status = PENDING

## Purpose
When a customer submits payment proof (image + transaction ID), the order's
`payment_status` should move from `UNPAID` to `PENDING` so the admin can see
at a glance that a submission is awaiting verification.

## Changes
- Recreates the `submit_payment` function (the version with `p_proof_url` parameter)
  to add `payment_status = 'PENDING'` to the existing UPDATE on `orders`.
- No schema changes, no new tables, no new columns.
- The Verify Payment admin flow remains the only way to move PENDING -> VERIFIED.

## Security
- Function is SECURITY DEFINER, search_path = public (unchanged).
- No RLS policy changes.
*/

CREATE OR REPLACE FUNCTION public.submit_payment(
  p_order_reference text,
  p_email text,
  p_payment_method text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_proof_url text DEFAULT NULL
)
RETURNS TABLE(out_success boolean, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, email, status, total_cents, payment_method
  INTO v_order
  FROM public.orders
  WHERE reference = upper(btrim(p_order_reference))
  AND lower(email) = lower(btrim(p_email));

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Order not found. Check your reference and email.'::text;
    RETURN;
  END IF;

  IF v_order.status != 'WAITING_PAYMENT' THEN
    RETURN QUERY SELECT false, 'Payment has already been submitted or the order is no longer awaiting payment.'::text;
    RETURN;
  END IF;

  INSERT INTO public.payment_submissions (
    order_id, payment_method, reference_number, amount_cents, note, proof_url
  ) VALUES (
    v_order.id,
    COALESCE(p_payment_method, v_order.payment_method),
    left(btrim(COALESCE(p_reference_number, '')), 200),
    v_order.total_cents,
    left(btrim(COALESCE(p_note, '')), 1000),
    p_proof_url
  );

  UPDATE public.orders
  SET payment_reference = left(btrim(COALESCE(p_reference_number, '')), 200),
    payment_submitted_at = now(),
    payment_status = 'PENDING',
    updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (v_order.id, 'WAITING_PAYMENT', v_order.email, 'Payment information submitted by customer');

  RETURN QUERY SELECT true, NULL::text;
END;
$function$;
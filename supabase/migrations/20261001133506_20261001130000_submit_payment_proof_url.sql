/*
# Add proof_url support to submit_payment RPC

1. Changes
- Updated `submit_payment` SECURITY DEFINER function to accept an optional `p_proof_url` text parameter.
- When provided, the proof URL (e.g. a base64 data URL of a payment screenshot) is stored in `payment_submissions.proof_url`.
- The `payment_submissions` table already has a `proof_url text NULL` column — no schema change needed.
2. Security
- No new tables or columns.
- No RLS changes.
- The function remains SECURITY DEFINER with `search_path = 'public'`.
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
      updated_at = now()
  WHERE id = v_order.id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (v_order.id, 'WAITING_PAYMENT', v_order.email, 'Payment information submitted by customer');

  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

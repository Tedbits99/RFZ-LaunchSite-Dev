/*
# Payment operator guard for privileged order RPCs

1. Plain-English explanation
   Three order functions (verify payment, change fulfillment status,
   change order status) could previously be called by any visitor with
   the public website key, which would let a bad actor mark an order as
   paid and trigger real supplier orders. This migration adds a check
   inside each function: only the background payment system (service
   role) or a signed-in admin may call them. Everyone else is refused.

2. New functions
   - `is_payment_operator()`: true only for the service role or a signed-in
     user with a row in the admins table.

3. Modified functions
   - verify_payment, complete_fulfillment, admin_change_order_status:
     identical logic and signatures, plus the operator guard at the top.
   - EXECUTE revoked from anon on all three; granted to authenticated
     (the internal guard enforces the admin check).

4. Important notes
   - No table or column changes. No data changes.
*/

CREATE OR REPLACE FUNCTION public.is_payment_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json ->> 'role' = 'service_role',
    false
  ) OR (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.admins a WHERE a.id = auth.uid()
    )
  );
$$;

-- ── verify_payment ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_payment(
  p_order_id uuid,
  p_verified_by text,
  p_verification_method text DEFAULT 'MANUAL',
  p_payment_reference text DEFAULT NULL,
  p_note text DEFAULT ''
)
RETURNS TABLE (out_id uuid, out_order_status text, out_payment_status text, out_fulfillment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_payment_status text;
  v_current_order_status text;
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT o.payment_status, o.status INTO v_current_payment_status, v_current_order_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_payment_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_current_payment_status = 'VERIFIED' THEN
    RETURN QUERY SELECT p_order_id, v_current_order_status, 'VERIFIED', o.fulfillment_status
    FROM public.orders o WHERE o.id = p_order_id;
    RETURN;
  END IF;

  IF v_current_payment_status NOT IN ('UNPAID', 'PENDING') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATE';
  END IF;

  UPDATE public.orders
  SET payment_status = 'VERIFIED',
      payment_verification_method = p_verification_method,
      payment_verified_at = now(),
      payment_verified_by = p_verified_by,
      payment_reference = COALESCE(p_payment_reference, payment_reference),
      status = 'PAYMENT_VERIFIED',
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, 'PAYMENT_VERIFIED', p_verified_by,
    COALESCE(NULLIF(p_note, ''), 'Payment verified (' || p_verification_method || ')'));

  RETURN QUERY
  SELECT p_order_id, 'PAYMENT_VERIFIED', 'VERIFIED', 'NOT_STARTED';
END;
$$;

-- ── complete_fulfillment ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_fulfillment(
  p_order_id uuid,
  p_fulfillment_status text,
  p_actor_email text DEFAULT 'fulfillment_system',
  p_note text DEFAULT ''
)
RETURNS TABLE (out_id uuid, out_order_status text, out_fulfillment_status text, out_transitioned boolean)
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

-- ── admin_change_order_status ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_change_order_status(
  p_order_id uuid,
  p_new_status text,
  p_actor_email text DEFAULT 'admin',
  p_note text DEFAULT ''
)
RETURNS TABLE (out_id uuid, out_status text, out_updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT o.status INTO v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF p_new_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'COMPLETED_NOT_ALLOWED_MANUALLY';
  END IF;

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
$$;

REVOKE EXECUTE ON FUNCTION public.verify_payment(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_payment(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_fulfillment(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO authenticated;

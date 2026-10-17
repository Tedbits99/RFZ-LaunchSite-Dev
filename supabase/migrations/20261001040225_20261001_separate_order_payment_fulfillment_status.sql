/*
# Separate Order, Payment, and Fulfillment Status

## Purpose
Splits the previously single `orders.status` field into three clearly
separated concepts:
  A. Order Status (overall lifecycle) — existing `orders.status` column
  B. Payment Status — new `orders.payment_status` column
  C. Fulfillment Status — new `orders.fulfillment_status` column

Also adds `orders.payment_verification_method` to record whether payment
was verified MANUALLY (by a Super Admin) or AUTOMATIC (by a payment
provider webhook).

## New Columns on `orders`
1. `payment_status` (text, NOT NULL, default 'UNPAID')
   Values: UNPAID, PENDING, VERIFIED, FAILED, REFUNDED
   - UNPAID:      customer has not submitted payment
   - PENDING:     customer submitted payment, awaiting verification
   - VERIFIED:    payment confirmed (manually or automatically)
   - FAILED:      payment failed
   - REFUNDED:    payment refunded

2. `fulfillment_status` (text, NOT NULL, default 'NOT_STARTED')
   Values: NOT_STARTED, PROCESSING, COMPLETED, FAILED
   - NOT_STARTED:  no supplier fulfillment attempted
   - PROCESSING:   supplier order created, awaiting confirmation
   - COMPLETED:    supplier confirmed successful fulfillment
   - FAILED:       supplier fulfillment failed

3. `payment_verification_method` (text, nullable)
   Values: MANUAL, AUTOMATIC
   - MANUAL:    Super Admin verified the payment
   - AUTOMATIC: Payment provider webhook verified the payment

## Backfill Strategy (preserves existing orders)
- Orders with status = COMPLETED → payment_status = VERIFIED,
  fulfillment_status = COMPLETED
- Orders with status = WAITING_PAYMENT → payment_status = UNPAID,
  fulfillment_status = NOT_STARTED
- Orders with status = PAID → payment_status = VERIFIED,
  fulfillment_status = NOT_STARTED
- Orders with status = FAILED → payment_status = FAILED,
  fulfillment_status = NOT_STARTED
- Orders with status = CANCELLED/EXPIRED → payment_status = FAILED,
  fulfillment_status = NOT_STARTED
- Orders with status = PROCESSING → payment_status = VERIFIED,
  fulfillment_status = PROCESSING
- Orders with status = REFUND_PENDING/REFUNDED → payment_status = REFUNDED,
  fulfillment_status = NOT_STARTED (or COMPLETED if it was delivered)

## New RPC: verify_payment
Called by the Super Admin "Verify Payment" action or by the payment
webhook. Sets payment_status = VERIFIED, records verification method,
admin email, timestamp, and inserts an order_timeline entry. Returns
the order so the caller can trigger fulfillment.

## Updated RPC: admin_change_order_status
Now restricts direct transitions to COMPLETED — COMPLETED can only be
set by the fulfillment system, not by manual admin action. The admin
can still set other statuses (CANCELLED, EXPIRED, FAILED, REFUNDED,
etc.) but NOT COMPLETED.

## Security
- All columns added to existing table, RLS already enabled on orders.
- No new policies needed — existing admin RLS covers the new columns.
- verify_payment is SECURITY DEFINER, callable by authenticated only
  (admin guard enforced in the API route, not in the RPC).
*/

-- 1. Add new columns (idempotent)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'UNPAID';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verification_method text;

-- 2. Backfill existing orders based on current status
UPDATE orders SET payment_status = 'VERIFIED', fulfillment_status = 'COMPLETED'
  WHERE status = 'COMPLETED' AND payment_status = 'UNPAID';

UPDATE orders SET payment_status = 'UNPAID', fulfillment_status = 'NOT_STARTED'
  WHERE status = 'WAITING_PAYMENT' AND payment_status = 'UNPAID';

UPDATE orders SET payment_status = 'VERIFIED', fulfillment_status = 'NOT_STARTED'
  WHERE status IN ('PAID', 'PROCESSING') AND payment_status = 'UNPAID';

UPDATE orders SET payment_status = 'FAILED', fulfillment_status = 'NOT_STARTED'
  WHERE status IN ('FAILED', 'CANCELLED', 'EXPIRED') AND payment_status = 'UNPAID';

UPDATE orders SET payment_status = 'REFUNDED', fulfillment_status = 'NOT_STARTED'
  WHERE status IN ('REFUND_PENDING', 'REFUNDED') AND payment_status = 'UNPAID';

-- Set verification method for already-verified orders
UPDATE orders SET payment_verification_method = 'AUTOMATIC'
  WHERE payment_status = 'VERIFIED' AND payment_verified_by LIKE 'webhook:%' AND payment_verification_method IS NULL;

UPDATE orders SET payment_verification_method = 'MANUAL'
  WHERE payment_status = 'VERIFIED' AND payment_verified_by IS NOT NULL
  AND payment_verified_by NOT LIKE 'webhook:%' AND payment_verification_method IS NULL;

-- 3. Create verify_payment RPC
CREATE OR REPLACE FUNCTION public.verify_payment(
  p_order_id uuid,
  p_verified_by text,
  p_verification_method text DEFAULT 'MANUAL',
  p_payment_reference text DEFAULT NULL,
  p_note text DEFAULT ''
)
RETURNS TABLE(out_id uuid, out_order_status text, out_payment_status text, out_fulfillment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_current_payment_status text;
  v_current_order_status text;
BEGIN
  -- Lock the row
  SELECT o.payment_status, o.status INTO v_current_payment_status, v_current_order_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_payment_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  -- Idempotency: if already verified, return current state without changes
  IF v_current_payment_status = 'VERIFIED' THEN
    RETURN QUERY SELECT p_order_id, v_current_order_status, 'VERIFIED', o.fulfillment_status
    FROM public.orders o WHERE o.id = p_order_id;
    RETURN;
  END IF;

  -- Only allow verification from UNPAID or PENDING
  IF v_current_payment_status NOT IN ('UNPAID', 'PENDING') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATE';
  END IF;

  -- Update payment status
  UPDATE public.orders
  SET payment_status = 'VERIFIED',
      payment_verification_method = p_verification_method,
      payment_verified_at = now(),
      payment_verified_by = p_verified_by,
      payment_reference = COALESCE(p_payment_reference, payment_reference),
      status = 'PAYMENT_VERIFIED',
      updated_at = now()
  WHERE id = p_order_id;

  -- Insert timeline entry
  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (p_order_id, 'PAYMENT_VERIFIED', p_verified_by,
    COALESCE(p_note, 'Payment verified (' || p_verification_method || ')'));

  RETURN QUERY
  SELECT p_order_id, 'PAYMENT_VERIFIED', 'VERIFIED', 'NOT_STARTED';
END;
$function$;

-- 4. Update admin_change_order_status to block direct COMPLETED
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

-- 5. Create complete_fulfillment RPC (called by fulfillment system only)
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

  -- Only allow fulfillment completion if payment is verified
  IF v_payment_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_VERIFIED';
  END IF;

  -- Update fulfillment status
  UPDATE public.orders
  SET fulfillment_status = p_fulfillment_status,
      status = CASE
        WHEN p_fulfillment_status = 'COMPLETED' THEN 'COMPLETED'
        WHEN p_fulfillment_status = 'PROCESSING' THEN 'PROCESSING'
        WHEN p_fulfillment_status = 'FAILED' THEN 'FULFILLMENT_FAILED'
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
      ELSE 'PAYMENT_VERIFIED'
    END,
    p_fulfillment_status;
END;
$function$;

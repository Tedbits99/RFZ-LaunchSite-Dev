/*
# Admin Manual Status Management — Expand statuses and unlock all admin transitions

## Summary
Adds EXPIRED to the orders status CHECK constraint and replaces the
admin_change_order_status RPC to allow admins to transition between ALL
valid statuses. The full status set is now:
  PENDING, WAITING_PAYMENT, PAID, PROCESSING, COMPLETED,
  FAILED, EXPIRED, CANCELLED, REFUND_PENDING, REFUNDED

## Changes

### 1. Orders status constraint
- Drops and recreates orders_status_check to include EXPIRED.
- Keeps all legacy statuses (PAYMENT_PENDING, REFUND_REQUESTED, DELIVERED)
  for backward compatibility.

### 2. admin_change_order_status RPC
- Replaces the function to allow ANY admin-initiated transition between
  the 10 canonical statuses (plus legacy ones).
- Same-status transitions still allowed (adds timeline note only).
- Still inserts a timeline entry and updates updated_at atomically.

### 3. Security
- Function remains SECURITY DEFINER (bypasses RLS for the update).
- EXECUTE granted to anon, authenticated (admin guard is in the API route).
*/

-- 1. Extend CHECK constraint to include EXPIRED
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (
  status IN (
    'PENDING', 'WAITING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED',
    'FAILED', 'EXPIRED', 'CANCELLED',
    'REFUND_PENDING', 'REFUNDED',
    -- Legacy statuses for backward compat
    'PAYMENT_PENDING', 'REFUND_REQUESTED', 'DELIVERED'
  )
);

-- 2. Replace RPC to allow all admin transitions
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
BEGIN
  SELECT o.status INTO v_current_status
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
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

GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO anon, authenticated;
/*
# Update orders status check constraint

Replace the old status check constraint to include the new order lifecycle statuses:
WAITING_PAYMENT, PAID, PROCESSING, COMPLETED, DELIVERED, CANCELLED, REFUND_PENDING, REFUNDED

Also keeps backward compatibility with old statuses (PENDING, PAYMENT_PENDING, FAILED, REFUND_REQUESTED)
so existing data isn't lost.
*/

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'WAITING_PAYMENT'::text,
    'PAID'::text,
    'PROCESSING'::text,
    'COMPLETED'::text,
    'DELIVERED'::text,
    'CANCELLED'::text,
    'REFUND_PENDING'::text,
    'REFUNDED'::text,
    -- Legacy statuses for backward compatibility
    'PENDING'::text,
    'PAYMENT_PENDING'::text,
    'FAILED'::text,
    'REFUND_REQUESTED'::text
  ]));

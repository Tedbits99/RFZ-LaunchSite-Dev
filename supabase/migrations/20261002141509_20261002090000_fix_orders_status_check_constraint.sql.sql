/*
# Fix orders status CHECK constraint — add PAYMENT_VERIFIED and FULFILLMENT_FAILED

## Root Cause
The `verify_payment` RPC sets `orders.status = 'PAYMENT_VERIFIED'` after verifying
a manual payment. However, the `orders_status_check` CHECK constraint on the `orders`
table did NOT include `PAYMENT_VERIFIED` (or `FULFILLMENT_FAILED`) in its allowed
values list. This caused the UPDATE inside `verify_payment` to fail with a
constraint violation, which surfaced to the admin as a generic error.

## Fix
Drop and recreate the `orders_status_check` constraint with the full set of
valid order statuses, including `PAYMENT_VERIFIED` and `FULFILLMENT_FAILED`.

## Important Notes
1. No data is changed — only the CHECK constraint is replaced.
2. The `verify_payment` RPC is NOT modified — it was already correct.
3. The `admin_change_order_status` VALID_STATUSES list in the API route is NOT
   modified — it already excluded PAYMENT_VERIFIED (which is only set by
   `verify_payment`, not by manual status changes).
4. This is safe to re-run (DROP IF EXISTS + CREATE).
*/

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY[
    'PENDING'::text,
    'WAITING_PAYMENT'::text,
    'PAYMENT_VERIFIED'::text,
    'PAID'::text,
    'PROCESSING'::text,
    'COMPLETED'::text,
    'DELIVERED'::text,
    'FULFILLMENT_FAILED'::text,
    'FAILED'::text,
    'EXPIRED'::text,
    'CANCELLED'::text,
    'REFUND_PENDING'::text,
    'REFUND_REQUESTED'::text,
    'REFUNDED'::text,
    'PAYMENT_PENDING'::text
  ]));

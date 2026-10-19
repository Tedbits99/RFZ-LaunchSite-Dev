/*
# Fix QR Ph max_amount_cents

## Context
The `paymongo_qrph` payment config row has `max_amount_cents = 100` (₱1.00),
which blocks all real package purchases. The cheapest package is ₱12.00 (1200
centavos), so every QR Ph checkout fails with "Maximum amount for QR Ph is ₱1."
inside the `create_order` RPC.

## Change
Set `max_amount_cents = NULL` for `paymongo_qrph` so there is no upper limit.
PayMongo QR Ph supports amounts up to ₱50,000 — far above any package price —
and the `create_order` RPC only checks `max_amount_cents IS NOT NULL AND
max_amount_cents > 0`, so NULL disables the check entirely.

## Security
No RLS or policy changes. This is a data-only update to an existing
configuration row. The row is already restricted to admin writes by existing
policies.
*/

UPDATE public.payment_config
SET max_amount_cents = NULL
WHERE method_key = 'paymongo_qrph';

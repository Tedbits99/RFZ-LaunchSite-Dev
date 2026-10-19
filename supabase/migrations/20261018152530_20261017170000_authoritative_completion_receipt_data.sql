-- Authoritative receipt data contract for future completion receipts.
--
-- Existing orders intentionally remain quantity-unknown (NULL).  The current
-- checkout creates exactly one package per order, so new orders are persisted
-- as quantity 1 without changing create_order's public signature.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS quantity integer;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_quantity_single_package_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_quantity_single_package_check
  CHECK (quantity IS NULL OR quantity = 1);

-- A malformed legacy recipient must be quarantinable without rolling back a
-- genuine supplier completion.  Only dead-letter rows may omit a recipient.
ALTER TABLE public.order_email_outbox
  ALTER COLUMN recipient_email DROP NOT NULL;

ALTER TABLE public.order_email_outbox
  DROP CONSTRAINT IF EXISTS order_email_outbox_recipient_email_check;

ALTER TABLE public.order_email_outbox
  ADD CONSTRAINT order_email_outbox_recipient_email_check
  CHECK (
    (recipient_email IS NOT NULL AND char_length(recipient_email) BETWEEN 3 AND 320)
    OR (recipient_email IS NULL AND status = 'dead_letter')
  );

ALTER TABLE public.order_email_outbox
  ALTER COLUMN receipt_snapshot SET DEFAULT '{}'::jsonb;

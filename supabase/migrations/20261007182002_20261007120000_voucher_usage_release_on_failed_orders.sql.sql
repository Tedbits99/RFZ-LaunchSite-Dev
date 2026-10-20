/*
# Release voucher usage when an order fails

1. Plain-English explanation
   Voucher usage is recorded at order creation (create_order inserts a
   voucher_usages row). If an order later fails, is cancelled, or expires,
   that usage slot should be given back to the customer so the voucher can
   still be used. This migration adds an automatic trigger on the orders
   table so usage is released no matter which code path sets the final
   failure status (admin RPC, cron job, payment webhook).

2. Modified tables
   - `orders`: no schema change. New trigger `trg_orders_voucher_release`.

3. Security changes
   - None. The trigger function is SECURITY DEFINER with a locked
     search_path, runs as the table owner, and cannot be called directly.

4. Important notes
   - Releases only on the transition INTO FAILED / CANCELLED / EXPIRED from
     a non-failed state, so it fires exactly once per failure.
   - Payment success is not affected: usage stays recorded while the order
     is waiting for/being verified for payment, and once paid the usage is
     permanently consumed as intended.
*/

CREATE OR REPLACE FUNCTION public.release_voucher_usage_on_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.voucher_id IS NOT NULL
     AND NEW.status IN ('FAILED', 'CANCELLED', 'EXPIRED')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN
    DELETE FROM public.voucher_usages
    WHERE voucher_id = NEW.voucher_id AND order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_voucher_release ON public.orders;

CREATE TRIGGER trg_orders_voucher_release
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.release_voucher_usage_on_failure();

-- Tighten write policies: customers never mutate order timeline or
-- payment submissions directly. All writes go through server routes
-- using the service role key.

DROP POLICY IF EXISTS "anon_insert_order_timeline" ON public.order_timeline;
DROP POLICY IF EXISTS "anon_update_order_timeline" ON public.order_timeline;
DROP POLICY IF EXISTS "anon_delete_order_timeline" ON public.order_timeline;
DROP POLICY IF EXISTS "service_all_order_timeline" ON public.order_timeline;

DROP POLICY IF EXISTS "anon_insert_payment_submissions" ON public.payment_submissions;
DROP POLICY IF EXISTS "anon_update_payment_submissions" ON public.payment_submissions;
DROP POLICY IF EXISTS "anon_delete_payment_submissions" ON public.payment_submissions;
DROP POLICY IF EXISTS "service_all_payment_submissions" ON public.payment_submissions;

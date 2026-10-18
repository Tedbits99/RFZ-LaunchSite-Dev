\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS reconciliation_concurrency_sleep ON public.order_timeline;
DROP FUNCTION IF EXISTS public.reconciliation_test_sleep_timeline();
DELETE FROM public.supplier_transactions WHERE id = '00000000-0000-0000-0000-000000000205';
DELETE FROM public.orders WHERE id = '00000000-0000-0000-0000-000000000204';
DELETE FROM public.suppliers WHERE id = '00000000-0000-0000-0000-000000000203';
DELETE FROM public.packages WHERE id = '00000000-0000-0000-0000-000000000202';
DELETE FROM public.games WHERE id = '00000000-0000-0000-0000-000000000201';

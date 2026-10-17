-- Remove duplicate payment_config SELECT policy (keep v2).
DROP POLICY IF EXISTS "public_read_enabled_payment_config" ON public.payment_config;

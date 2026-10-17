-- Fix search_path on generate_order_reference and add explicit deny
-- policies on vouchers/voucher_usages.

ALTER FUNCTION public.generate_order_reference() SET search_path = public;

-- Explicitly deny anon/authenticated on vouchers and voucher_usages.
-- These are only accessed via SECURITY DEFINER functions.
CREATE POLICY "deny_vouchers_select" ON public.vouchers
  FOR SELECT TO anon, authenticated
  USING (false);

CREATE POLICY "deny_voucher_usages_select" ON public.voucher_usages
  FOR SELECT TO anon, authenticated
  USING (false);

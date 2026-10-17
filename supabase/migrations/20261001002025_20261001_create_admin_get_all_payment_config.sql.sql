-- Create the missing admin_get_all_payment_config RPC function.
-- The admin payments page and GET /api/payment-config both call this RPC,
-- but it was never created, so no payment methods load in admin.
-- SECURITY DEFINER bypasses RLS so admins see ALL methods (enabled + disabled).

CREATE OR REPLACE FUNCTION public.admin_get_all_payment_config()
RETURNS SETOF public.payment_config
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT * FROM public.payment_config ORDER BY sort_order, display_name;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_get_all_payment_config() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_payment_config() TO authenticated;

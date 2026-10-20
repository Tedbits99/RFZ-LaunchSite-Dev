-- Restrict admin_change_order_status to authenticated users only.
-- The admin API route checks requireAdmin() before calling it, but the
-- function should not be directly callable by the anon role.
REVOKE EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO authenticated;

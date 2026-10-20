-- Order archival changes customer order state and is callable only by the
-- service-role worker or the server-side admin client.
REVOKE EXECUTE ON FUNCTION public.archive_old_unpaid_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_unpaid_orders() TO service_role;

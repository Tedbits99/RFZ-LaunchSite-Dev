-- The signed FazerCards webhook performs a read-only supplier-reference lookup
-- before recording an event. The deployed service_role lacked SELECT, causing
-- PostgREST 42501 and webhook 503s. Grant only that table privilege; RLS and
-- browser-role grants are unchanged.
GRANT SELECT ON TABLE public.supplier_transactions TO service_role;

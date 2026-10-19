-- Revoke anon access to set_supplier_credential — only service role should set credentials
REVOKE EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) FROM anon, authenticated;

-- Run after the scoped FazerCards webhook lookup migration. This protects the
-- 42501 fix from accidentally turning into broad service_role or browser access.
DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'service_role must be able to read supplier references for signed webhooks';
  END IF;
  IF has_table_privilege('service_role', 'public.supplier_transactions', 'INSERT')
     OR has_table_privilege('service_role', 'public.supplier_transactions', 'UPDATE')
     OR has_table_privilege('service_role', 'public.supplier_transactions', 'DELETE') THEN
    RAISE EXCEPTION 'webhook lookup migration must not add service_role write privileges';
  END IF;
  IF has_table_privilege('anon', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'anonymous browser access to supplier transactions must remain denied';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'existing admin SELECT grant must remain intact';
  END IF;
END;
$$;

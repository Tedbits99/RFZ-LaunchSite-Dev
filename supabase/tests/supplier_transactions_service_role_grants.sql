-- Disposable regression only. Fresh Supabase defaults may already grant DML
-- to service_role; hosted ACLs differ. Check the migration's delta rather than
-- claiming it revokes existing privileges. All fixture ACL changes roll back.
BEGIN;

DO $$ BEGIN
  IF NOT has_table_privilege('service_role', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'installed migration must permit signed-webhook reference lookups';
  END IF;
END $$;

CREATE TEMP TABLE supplier_acl_original AS
SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
WHERE c.oid = 'public.supplier_transactions'::regclass;

-- Simulate missing SELECT while retaining this environment's existing DML.
REVOKE SELECT ON public.supplier_transactions FROM service_role;
DO $$ BEGIN
  IF has_table_privilege('service_role', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'missing-SELECT fixture must deny the webhook lookup';
  END IF;
END $$;

\ir ../migrations/20261028115900_grant_service_role_supplier_transactions_select.sql

DO $$ BEGIN
  IF EXISTS (
    (SELECT * FROM supplier_acl_original EXCEPT
     SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = 'public.supplier_transactions'::regclass)
    UNION ALL
    (SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
     WHERE c.oid = 'public.supplier_transactions'::regclass
     EXCEPT SELECT * FROM supplier_acl_original)
  ) THEN
    RAISE EXCEPTION 'SELECT repair must restore the exact ACL without changing existing grants';
  END IF;
END $$;

-- Reproduce the independently observed hosted missing-SELECT/no-DML baseline.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.supplier_transactions FROM service_role;
CREATE TEMP TABLE supplier_acl_hosted_fixture AS
SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
WHERE c.oid = 'public.supplier_transactions'::regclass;

\ir ../migrations/20261028115900_grant_service_role_supplier_transactions_select.sql

DO $$ BEGIN
  IF NOT has_table_privilege('service_role', 'public.supplier_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'hosted-style webhook fixture must gain SELECT';
  END IF;
  IF has_table_privilege('service_role', 'public.supplier_transactions', 'INSERT')
     OR has_table_privilege('service_role', 'public.supplier_transactions', 'UPDATE')
     OR has_table_privilege('service_role', 'public.supplier_transactions', 'DELETE') THEN
    RAISE EXCEPTION 'hosted-style fixture must not gain supplier-transaction write privileges';
  END IF;
  IF EXISTS (
    WITH actual AS (
      SELECT a.* FROM pg_class c, LATERAL aclexplode(c.relacl) a
      WHERE c.oid = 'public.supplier_transactions'::regclass
      AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'SELECT')
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM supplier_acl_hosted_fixture)
    UNION ALL
    (SELECT * FROM supplier_acl_hosted_fixture EXCEPT SELECT * FROM actual)
  ) THEN
    RAISE EXCEPTION 'webhook migration changed privileges outside service_role SELECT';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.supplier_transactions'::regclass) THEN
    RAISE EXCEPTION 'supplier transaction RLS must remain enabled';
  END IF;
  RAISE NOTICE 'SUPPLIER_WEBHOOK_SELECT_GRANT_PASS existing_acl_preserved=true hosted_fixture_no_writes=true';
END $$;

ROLLBACK;

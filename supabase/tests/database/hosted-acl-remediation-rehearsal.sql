\set ON_ERROR_STOP on

-- Disposable PostgreSQL 17 rehearsal. Run as a NOSUPERUSER postgres role
-- with no membership in supabase_admin, matching the verified hosted
-- migration authority. It applies only the postgres-owned ACL scope and
-- proves that provider-owned defaults remain unchanged. Never target hosted.
DO $$
BEGIN
  IF current_user <> 'postgres'
     OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     OR pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_WRONG_DISPOSABLE_OWNER';
  END IF;
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_POSTGRESQL_17_REQUIRED';
  END IF;
END;
$$;

CREATE TEMP TABLE expected_affected_acl (
  role_name text NOT NULL,
  table_name text NOT NULL,
  PRIMARY KEY (role_name, table_name)
);

INSERT INTO expected_affected_acl (role_name, table_name)
SELECT role_name, table_name
FROM (VALUES
  ('announcements'), ('app_settings'), ('email_sent_log'), ('game_input_fields'),
  ('games'), ('global_announcement'), ('notifications'), ('order_notes'),
  ('packages'), ('payment_config'), ('payment_submissions'),
  ('payment_transactions'), ('player_cache'), ('promotions'), ('refunds'),
  ('supplier_package_mappings'), ('supplier_test_runs'), ('suppliers'),
  ('support_messages'), ('support_tickets'), ('verification_attempts'),
  ('verified_users'), ('voucher_usages'), ('vouchers')
) AS tables(table_name)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(role_name);

INSERT INTO expected_affected_acl (role_name, table_name)
VALUES ('authenticated', 'admins'),
       ('authenticated', 'order_timeline'),
       ('authenticated', 'orders');

CREATE TEMP TABLE expected_default_acl (
  creator_name text NOT NULL,
  schema_name text NOT NULL,
  grantee_name text NOT NULL,
  privilege_name text NOT NULL,
  PRIMARY KEY (creator_name, schema_name, grantee_name, privilege_name)
);

INSERT INTO expected_default_acl (creator_name, schema_name, grantee_name, privilege_name)
SELECT context.creator_name, context.schema_name, role_name, privilege_name
FROM (VALUES
  ('postgres', 'public'),
  ('supabase_admin', 'public'),
  ('supabase_admin', 'graphql'),
  ('supabase_admin', 'graphql_public'),
  ('postgres', 'storage')
) AS context(creator_name, schema_name)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(role_name)
CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS privileges(privilege_name);

CREATE TEMP TABLE before_ddl_privileges AS
SELECT r.role_name, c.relname AS table_name, p.privilege_name,
       has_table_privilege(r.role_name, c.oid, p.privilege_name) AS has_privilege
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM expected_affected_acl AS expected
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
    LEFT JOIN before_ddl_privileges AS before
      ON before.role_name = expected.role_name
     AND before.table_name = expected.table_name
     AND before.privilege_name = p.privilege_name
    WHERE before.has_privilege IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_DIRECT_GRANT_FIXTURE_INCOMPLETE';
  END IF;
END;
$$;

-- The current hosted postgres authority must not be able to change
-- supabase_admin defaults. Assert the exact expected SQLSTATE and do not
-- compensate by granting membership or changing roles.
DO $$
DECLARE
  v_sqlstate text;
BEGIN
  BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_PROVIDER_PRIVILEGE_BOUNDARY_UNEXPECTED sqlstate=%', v_sqlstate;
  END IF;
END;
$$;

CREATE TEMP TABLE before_safe_privileges AS
SELECT r.role_name, c.relname AS table_name, p.privilege_name,
       has_table_privilege(r.role_name, c.oid, p.privilege_name) AS has_privilege
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

CREATE TEMP TABLE before_rls AS
SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

CREATE TEMP TABLE before_policies AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';

CREATE TEMP TABLE before_default_acl AS
SELECT creator.rolname AS creator_name,
       COALESCE(schema_name.nspname, '') AS schema_name,
       acl.grantee,
       acl.grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
       acl.privilege_type AS privilege_name,
       acl.is_grantable
FROM pg_default_acl AS d
JOIN pg_roles AS creator ON creator.oid = d.defaclrole
LEFT JOIN pg_namespace AS schema_name ON schema_name.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM expected_default_acl AS expected
    WHERE NOT EXISTS (
      SELECT 1 FROM before_default_acl AS before
      WHERE before.creator_name = expected.creator_name
        AND before.schema_name = expected.schema_name
        AND before.grantee_name = expected.grantee_name
        AND before.privilege_name = expected.privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_DEFAULT_GRANT_FIXTURE_INCOMPLETE';
  END IF;
END;
$$;

CREATE TEMP TABLE before_other_role_acl AS
SELECT c.relname AS table_name, acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (acl.grantee = 0 OR acl.grantee = to_regrole('service_role')::oid);

-- Execute the exact migration candidate only in the disposable PG17 harness.
\ir ../../migrations/20261028113000_revoke_browser_table_ddl_privileges.sql

CREATE TEMP TABLE after_ddl_privileges AS
SELECT r.role_name, c.relname AS table_name, p.privilege_name,
       has_table_privilege(r.role_name, c.oid, p.privilege_name) AS has_privilege
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

CREATE TEMP TABLE after_safe_privileges AS
SELECT r.role_name, c.relname AS table_name, p.privilege_name,
       has_table_privilege(r.role_name, c.oid, p.privilege_name) AS has_privilege
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_name)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

CREATE TEMP TABLE after_rls AS
SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

CREATE TEMP TABLE after_policies AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';

CREATE TEMP TABLE after_default_acl AS
SELECT creator.rolname AS creator_name,
       COALESCE(schema_name.nspname, '') AS schema_name,
       acl.grantee,
       acl.grantor,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee_name,
       acl.privilege_type AS privilege_name,
       acl.is_grantable
FROM pg_default_acl AS d
JOIN pg_roles AS creator ON creator.oid = d.defaclrole
LEFT JOIN pg_namespace AS schema_name ON schema_name.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee;

CREATE TEMP TABLE after_other_role_acl AS
SELECT c.relname AS table_name, acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND (acl.grantee = 0 OR acl.grantee = to_regrole('service_role')::oid);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM expected_affected_acl AS expected
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
    JOIN after_ddl_privileges AS after
      ON after.role_name = expected.role_name
     AND after.table_name = expected.table_name
     AND after.privilege_name = p.privilege_name
    WHERE after.has_privilege
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_EXCESS_GRANT_REMAINS';
  END IF;

  IF EXISTS (
    SELECT 1 FROM before_ddl_privileges AS before
    JOIN after_ddl_privileges AS after USING (role_name, table_name, privilege_name)
    WHERE NOT EXISTS (
      SELECT 1 FROM expected_affected_acl AS expected
      WHERE expected.role_name = before.role_name
        AND expected.table_name = before.table_name
    )
      AND before.has_privilege IS DISTINCT FROM after.has_privilege
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_UNAUDITED_TABLE_ACL_CHANGED';
  END IF;

  IF EXISTS (SELECT * FROM before_safe_privileges EXCEPT SELECT * FROM after_safe_privileges)
     OR EXISTS (SELECT * FROM after_safe_privileges EXCEPT SELECT * FROM before_safe_privileges) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_SELECT_DML_GRANTS_CHANGED';
  END IF;
  IF EXISTS (SELECT * FROM before_rls EXCEPT SELECT * FROM after_rls)
     OR EXISTS (SELECT * FROM after_rls EXCEPT SELECT * FROM before_rls) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_RLS_CONFIGURATION_CHANGED';
  END IF;
  IF EXISTS (SELECT * FROM before_policies EXCEPT SELECT * FROM after_policies)
     OR EXISTS (SELECT * FROM after_policies EXCEPT SELECT * FROM before_policies) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_RLS_POLICIES_CHANGED';
  END IF;
  IF EXISTS (
    SELECT * FROM (
      (SELECT * FROM before_default_acl EXCEPT SELECT * FROM after_default_acl)
      EXCEPT
      SELECT before.*
      FROM before_default_acl AS before
      JOIN expected_default_acl AS expected
        ON expected.creator_name = before.creator_name
       AND expected.schema_name = before.schema_name
       AND expected.grantee_name = before.grantee_name
       AND expected.privilege_name = before.privilege_name
      WHERE expected.creator_name = 'postgres'
        AND expected.schema_name IN ('public', 'storage')
    ) AS unexplained_removed_defaults
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_UNAUDITED_DEFAULT_ACL_CHANGED';
  END IF;
  IF EXISTS (SELECT * FROM after_default_acl EXCEPT SELECT * FROM before_default_acl) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_DEFAULT_ACL_ADDED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM after_default_acl
    WHERE creator_name = 'postgres'
      AND schema_name IN ('public', 'storage')
      AND grantee_name IN ('anon', 'authenticated')
      AND privilege_name IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_POSTGRES_DEFAULTS_REMAIN';
  END IF;
  IF (
    SELECT count(*) FROM after_default_acl
    WHERE creator_name = 'supabase_admin'
      AND schema_name IN ('public', 'graphql', 'graphql_public')
      AND grantee_name IN ('anon', 'authenticated')
      AND privilege_name IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) <> 24 THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_PROVIDER_DEFAULTS_CHANGED';
  END IF;
  IF EXISTS (SELECT * FROM before_other_role_acl EXCEPT SELECT * FROM after_other_role_acl)
     OR EXISTS (SELECT * FROM after_other_role_acl EXCEPT SELECT * FROM before_other_role_acl) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_PUBLIC_OR_SERVICE_ROLE_ACL_CHANGED';
  END IF;

  IF has_table_privilege('anon', 'public.payment_transactions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_transactions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.payment_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_PAYMENT_TRANSACTION_SELECT_CONTRACT_CHANGED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_transactions'
      AND policyname = 'admin_select_payment_transactions'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_PAYMENT_ADMIN_POLICY_MISSING';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.admins', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.orders', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_ADMIN_OR_CUSTOMER_READ_GRANT_CHANGED';
  END IF;
END;
$$;

DO $$ BEGIN
  RAISE NOTICE 'HOSTED_ACL_POSTGRES17_NON_SUPERUSER_REHEARSAL_PASS provider_defaults_preserved=24';
END $$;

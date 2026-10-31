-- PROVIDER-AUTHORIZED ACL OPERATION; NOT A NORMAL SUPABASE MIGRATION.
-- The trusted read-only audit found 24 excess default-ACL entries owned by
-- supabase_admin in public/graphql/graphql_public. The hosted postgres role is
-- neither a member of nor authorized to SET ROLE supabase_admin (SQLSTATE
-- 42501 was observed in the disposable authority rehearsal). Do not copy this
-- file into supabase/migrations or apply it with the ordinary postgres login.
-- Execute only through a Supabase-supported session with supabase_admin
-- authority after the separate owner/provider approval described in
-- docs/hosted-acl-remediation-execution.md.

BEGIN;

DO $$
DECLARE
  v_default_count integer;
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'PROVIDER_ACL_REQUIRES_POSTGRESQL_17';
  END IF;
  IF to_regrole('supabase_admin') IS NULL
     OR to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_ACL_REQUIRED_ROLE_MISSING';
  END IF;
  IF current_user <> 'supabase_admin'
     AND NOT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
     AND NOT pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'PROVIDER_ACL_SUPABASE_ADMIN_AUTHORITY_REQUIRED';
  END IF;
  IF to_regnamespace('public') IS NULL
     OR to_regnamespace('graphql') IS NULL
     OR to_regnamespace('graphql_public') IS NULL THEN
    RAISE EXCEPTION 'PROVIDER_ACL_AUDITED_SCHEMA_MISSING';
  END IF;

  SELECT count(*) INTO v_default_count
  FROM pg_default_acl AS d
  JOIN pg_roles AS creator ON creator.oid = d.defaclrole
  JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclobjtype = 'r'
    AND creator.rolname = 'supabase_admin'
    AND n.nspname IN ('public', 'graphql', 'graphql_public')
    AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
    AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF v_default_count NOT IN (0, 24) THEN
    RAISE EXCEPTION 'PROVIDER_ACL_BASELINE_MISMATCH count=%', v_default_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclobjtype = 'r'
      AND creator.rolname = 'supabase_admin'
      AND n.nspname IN ('public', 'graphql', 'graphql_public')
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      AND (acl.grantor <> creator.oid OR acl.is_grantable)
  ) THEN
    RAISE EXCEPTION 'PROVIDER_ACL_GRANT_PROVENANCE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclobjtype = 'r'
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      AND (
        acl.grantee = 0
        OR acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
           AND NOT (
             creator.rolname = 'supabase_admin'
             AND n.nspname IN ('public', 'graphql', 'graphql_public')
           )
      )
  ) THEN
    RAISE EXCEPTION 'PROVIDER_ACL_UNAUDITED_DEFAULT_GRANT';
  END IF;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclobjtype = 'r'
      AND creator.rolname = 'supabase_admin'
      AND n.nspname IN ('public', 'graphql', 'graphql_public')
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_ACL_REVOKE_INCOMPLETE';
  END IF;
  RAISE NOTICE 'HOSTED_ACL_PROVIDER_SCOPE_PASS';
END;
$$;

COMMIT;

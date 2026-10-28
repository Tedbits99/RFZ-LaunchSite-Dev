-- Read-only metadata audit 40639888077 (project ketdhcmwowzztcdlmris,
-- PostgreSQL 17.11) found the exact direct browser-role grants below. All 36
-- public tables are owned by postgres. This file removes only the audited
-- TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN grants from anon/authenticated
-- on 24 tables for both roles and 3 additional tables for authenticated.
-- It also removes postgres-owned defaults in public/storage only.
--
-- supabase_admin-owned defaults are deliberately outside this migration.
-- Hosted postgres cannot impersonate that managed role; remediation requires
-- a Supabase-supported execution path or provider escalation.
-- No hosted application or migration is authorized by this source change.

BEGIN;

DO $$
DECLARE
  v_table text;
  v_missing text[];
  v_direct_count integer;
  v_postgres_default_count integer;
  v_provider_default_count integer;
  v_unexpected_default_entries text;
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_REMEDIATION_REQUIRES_POSTGRESQL_17';
  END IF;
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_REMEDIATION_REQUIRES_POSTGRES_OWNER';
  END IF;
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL
     OR to_regrole('supabase_admin') IS NULL THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_REQUIRED_ROLE_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_BROWSER_ROLE_MEMBERSHIP';
  END IF;
  IF to_regnamespace('public') IS NULL OR to_regnamespace('storage') IS NULL
     OR to_regnamespace('graphql') IS NULL OR to_regnamespace('graphql_public') IS NULL THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_AUDITED_SCHEMA_MISSING';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
    'games', 'global_announcement', 'notifications', 'order_notes',
    'packages', 'payment_config', 'payment_submissions',
    'payment_transactions', 'player_cache', 'promotions', 'refunds',
    'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
    'support_messages', 'support_tickets', 'verification_attempts',
    'verified_users', 'voucher_usages', 'vouchers', 'admins',
    'order_timeline', 'orders'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      v_missing := array_append(v_missing, v_table);
    END IF;
  END LOOP;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_AUDITED_TABLE_MISSING: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
        'games', 'global_announcement', 'notifications', 'order_notes',
        'packages', 'payment_config', 'payment_submissions',
        'payment_transactions', 'player_cache', 'promotions', 'refunds',
        'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
        'support_messages', 'support_tickets', 'verification_attempts',
        'verified_users', 'voucher_usages', 'vouchers', 'admins',
        'order_timeline', 'orders'
      ])
      AND c.relkind IN ('r', 'p')
      AND (NOT c.relrowsecurity OR c.relowner <> to_regrole('postgres')::oid)
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_TABLE_RLS_OR_OWNER_MISMATCH';
  END IF;

  -- The audited baseline has precisely 204 direct excess privilege entries:
  -- 24 tables x 2 roles x 4 privileges, plus 3 tables x 1 role x 4. Accept
  -- either that complete pre-state or the complete post-state so a retry is
  -- safe; reject partial/unexpected drift rather than broadening the REVOKE.
  SELECT count(*) INTO v_direct_count
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY[
      'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
      'games', 'global_announcement', 'notifications', 'order_notes',
      'packages', 'payment_config', 'payment_submissions',
      'payment_transactions', 'player_cache', 'promotions', 'refunds',
      'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
      'support_messages', 'support_tickets', 'verification_attempts',
      'verified_users', 'voucher_usages', 'vouchers', 'admins',
      'order_timeline', 'orders'
    ])
    AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
    AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF v_direct_count NOT IN (0, 204) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_DIRECT_GRANT_BASELINE_MISMATCH count=%', v_direct_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
        'games', 'global_announcement', 'notifications', 'order_notes',
        'packages', 'payment_config', 'payment_submissions',
        'payment_transactions', 'player_cache', 'promotions', 'refunds',
        'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
        'support_messages', 'support_tickets', 'verification_attempts',
        'verified_users', 'voucher_usages', 'vouchers', 'admins',
        'order_timeline', 'orders'
      ])
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      AND (acl.grantor <> to_regrole('postgres')::oid OR acl.is_grantable)
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_DIRECT_GRANT_PROVENANCE_MISMATCH';
  END IF;

  -- Fail closed on PUBLIC grants or excess browser grants outside the audited
  -- 27 role/table pairs. No PUBLIC grant was recorded in the trusted audit.
  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND acl.grantee = 0
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_PUBLIC_GRANT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      AND NOT (
        c.relname = ANY (ARRAY[
          'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
          'games', 'global_announcement', 'notifications', 'order_notes',
          'packages', 'payment_config', 'payment_submissions',
          'payment_transactions', 'player_cache', 'promotions', 'refunds',
          'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
          'support_messages', 'support_tickets', 'verification_attempts',
          'verified_users', 'voucher_usages', 'vouchers'
        ]) AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
        OR c.relname = ANY (ARRAY['admins', 'order_timeline', 'orders'])
           AND acl.grantee = to_regrole('authenticated')::oid
      )
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNAUDITED_BROWSER_TABLE_GRANT';
  END IF;

  -- The audit recorded exactly 16 postgres-owned defaults in public/storage
  -- and 24 supabase_admin-owned defaults in public/graphql/graphql_public.
  -- Global browser defaults and PUBLIC defaults were absent. This migration
  -- changes only the postgres-owned contexts; the provider-owned 24 remain.
  SELECT count(*) INTO v_postgres_default_count
  FROM pg_default_acl AS d
  JOIN pg_roles AS creator ON creator.oid = d.defaclrole
  JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclobjtype = 'r'
    AND creator.rolname = 'postgres'
    AND n.nspname IN ('public', 'storage')
    AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
    AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF v_postgres_default_count NOT IN (0, 16) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_POSTGRES_DEFAULT_BASELINE_MISMATCH count=%', v_postgres_default_count;
  END IF;

  SELECT count(*) INTO v_provider_default_count
  FROM pg_default_acl AS d
  JOIN pg_roles AS creator ON creator.oid = d.defaclrole
  JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclobjtype = 'r'
    AND creator.rolname = 'supabase_admin'
    AND n.nspname IN ('public', 'graphql', 'graphql_public')
    AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
    AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  -- Supabase local fixtures can omit provider defaults; on the hosted target,
  -- the protected preflight separately requires the audited count of 24.
  IF v_provider_default_count NOT IN (0, 24) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_PROVIDER_DEFAULT_BASELINE_MISMATCH count=%', v_provider_default_count;
  END IF;

  SELECT string_agg(entry, ', ' ORDER BY entry)
  INTO v_unexpected_default_entries
  FROM (
    SELECT format('%I.%I grantee=%I privilege=%s', creator.rolname,
      COALESCE(n.nspname, '<global>'),
      CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE pg_get_userbyid(acl.grantee) END,
      acl.privilege_type) AS entry
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
             creator.rolname = 'postgres' AND n.nspname IN ('public', 'storage')
             OR creator.rolname = 'supabase_admin' AND n.nspname IN ('public', 'graphql', 'graphql_public')
           )
      )
    ORDER BY creator.rolname, n.nspname, acl.grantee, acl.privilege_type
    LIMIT 10
  ) AS unexpected_defaults;
  IF v_unexpected_default_entries IS NOT NULL THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_DEFAULT_GRANT entries=%', v_unexpected_default_entries;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclobjtype = 'r'
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
      AND (
        (creator.rolname = 'postgres' AND n.nspname IN ('public', 'storage'))
        OR (creator.rolname = 'supabase_admin' AND n.nspname IN ('public', 'graphql', 'graphql_public'))
      )
      AND (acl.grantor <> creator.oid OR acl.is_grantable)
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_DEFAULT_GRANT_PROVENANCE_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclnamespace = 0
      AND creator.rolname IN ('postgres', 'supabase_admin')
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_GLOBAL_BROWSER_DEFAULT_GRANT';
  END IF;
END;
$$;

-- Exact, audited relation-role scope only. Safe SELECT/DML grants are untouched.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.announcements, public.app_settings, public.email_sent_log,
  public.game_input_fields, public.games, public.global_announcement,
  public.notifications, public.order_notes, public.packages, public.payment_config,
  public.payment_submissions, public.payment_transactions, public.player_cache,
  public.promotions, public.refunds, public.supplier_package_mappings,
  public.supplier_test_runs, public.suppliers, public.support_messages,
  public.support_tickets, public.verification_attempts, public.verified_users,
  public.voucher_usages, public.vouchers
FROM anon, authenticated;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.admins, public.order_timeline, public.orders
FROM authenticated;

-- These two default-ACL owners are the only contexts this hosted postgres role
-- can safely change. The three supabase_admin contexts remain untouched.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

DO $$
DECLARE
  v_provider_default_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
        'games', 'global_announcement', 'notifications', 'order_notes',
        'packages', 'payment_config', 'payment_submissions',
        'payment_transactions', 'player_cache', 'promotions', 'refunds',
        'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
        'support_messages', 'support_tickets', 'verification_attempts',
        'verified_users', 'voucher_usages', 'vouchers', 'admins',
        'order_timeline', 'orders'
      ])
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_REVOKE_INCOMPLETE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE d.defaclobjtype = 'r'
      AND creator.rolname = 'postgres'
      AND n.nspname IN ('public', 'storage')
      AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_POSTGRES_DEFAULT_REVOKE_INCOMPLETE';
  END IF;

  SELECT count(*) INTO v_provider_default_count
  FROM pg_default_acl AS d
  JOIN pg_roles AS creator ON creator.oid = d.defaclrole
  JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
  WHERE d.defaclobjtype = 'r'
    AND creator.rolname = 'supabase_admin'
    AND n.nspname IN ('public', 'graphql', 'graphql_public')
    AND acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
    AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF v_provider_default_count NOT IN (0, 24) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_PROVIDER_DEFAULTS_WERE_CHANGED count=%', v_provider_default_count;
  END IF;
  RAISE NOTICE 'HOSTED_ACL_POSTGRES_SCOPE_PASS provider_owned_defaults_pending=24';
END;
$$;

COMMIT;

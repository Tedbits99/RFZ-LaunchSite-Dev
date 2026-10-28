-- Metadata-only hosted audit 40639888077 verified these excess privileges on
-- existing public tables in project ketdhcmwowzztcdlmris (PostgreSQL 17.11).
-- This migration removes only TRUNCATE, TRIGGER, REFERENCES, and MAINTAIN from
-- anon/authenticated on the exact audited table-role pairs. It preserves all
-- SELECT/INSERT/UPDATE/DELETE grants, RLS, policies, PUBLIC, and service_role.
-- No hosted application or migration is authorized by this source change.

DO $$
DECLARE
  v_table text;
  v_missing text[];
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
  IF to_regnamespace('public') IS NULL
     OR to_regnamespace('storage') IS NULL
     OR to_regnamespace('graphql') IS NULL
     OR to_regnamespace('graphql_public') IS NULL THEN
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
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_AUDITED_TABLE_RLS_DISABLED';
  END IF;

  -- The audit found no PUBLIC grant for these privileges. Fail closed if that
  -- baseline has changed; this migration intentionally does not edit PUBLIC.
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
      AND acl.grantee = 0
      AND acl.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_PUBLIC_GRANT';
  END IF;

  -- The audited defaults contained browser-role grants, not PUBLIC grants.
  -- Do not leave a broader default path in place or silently change it here.
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    LEFT JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE (
      (creator.rolname = 'postgres'
        AND (d.defaclnamespace = 0 OR n.nspname IN ('public', 'storage')))
      OR (creator.rolname = 'supabase_admin'
        AND (d.defaclnamespace = 0 OR n.nspname IN ('public', 'graphql', 'graphql_public')))
    )
      AND acl.grantee = 0
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_UNEXPECTED_PUBLIC_DEFAULT_GRANT';
  END IF;

  -- A schema-specific REVOKE cannot cancel a privilege granted globally.
  -- The audit reported no such global browser-role defaults; stop if that
  -- provenance has changed rather than claiming the scoped cleanup is enough.
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

-- All four privileges were present for both browser roles on these 24 tables.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.announcements,
  public.app_settings,
  public.email_sent_log,
  public.game_input_fields,
  public.games,
  public.global_announcement,
  public.notifications,
  public.order_notes,
  public.packages,
  public.payment_config,
  public.payment_submissions,
  public.payment_transactions,
  public.player_cache,
  public.promotions,
  public.refunds,
  public.supplier_package_mappings,
  public.supplier_test_runs,
  public.suppliers,
  public.support_messages,
  public.support_tickets,
  public.verification_attempts,
  public.verified_users,
  public.voucher_usages,
  public.vouchers
FROM anon, authenticated;

-- The audit found these four privileges for authenticated only on this set.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.admins,
  public.order_timeline,
  public.orders
FROM authenticated;

-- Correct only the five creator/schema contexts evidenced by the audit. These
-- are exact browser-role table defaults; no other schema, role, object kind,
-- PUBLIC privilege, or service_role default is changed.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'announcements', 'app_settings', 'email_sent_log', 'game_input_fields',
      'games', 'global_announcement', 'notifications', 'order_notes',
      'packages', 'payment_config', 'payment_submissions',
      'payment_transactions', 'player_cache', 'promotions', 'refunds',
      'supplier_package_mappings', 'supplier_test_runs', 'suppliers',
      'support_messages', 'support_tickets', 'verification_attempts',
      'verified_users', 'voucher_usages', 'vouchers'
    ]) AS t(table_name)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
    WHERE has_table_privilege(
      r.role_name,
      to_regclass(format('public.%I', t.table_name)),
      p.privilege_name
    )
  ) OR EXISTS (
    SELECT 1
    FROM unnest(ARRAY['admins', 'order_timeline', 'orders']) AS t(table_name)
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege_name)
    WHERE has_table_privilege(
      'authenticated',
      to_regclass(format('public.%I', t.table_name)),
      p.privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_REVOKE_INCOMPLETE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    JOIN pg_namespace AS n ON n.oid = d.defaclnamespace
    JOIN pg_roles AS creator ON creator.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    JOIN pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE d.defaclobjtype = 'r'
      AND (
        (creator.rolname = 'postgres' AND n.nspname IN ('public', 'storage'))
        OR (creator.rolname = 'supabase_admin' AND n.nspname IN ('public', 'graphql', 'graphql_public'))
      )
      AND grantee.rolname IN ('anon', 'authenticated')
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'BROWSER_DDL_ACL_DEFAULT_REVOKE_INCOMPLETE';
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
    RAISE EXCEPTION 'BROWSER_DDL_ACL_GLOBAL_DEFAULT_REVOKE_INCOMPLETE';
  END IF;
END;
$$;

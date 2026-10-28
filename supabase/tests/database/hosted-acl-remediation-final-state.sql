\set ON_ERROR_STOP on

DO $$
DECLARE
  v_remaining integer;
BEGIN
  IF current_user <> 'bootstrap'
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_FIXTURE_REQUIRES_BOOTSTRAP';
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres')
     OR pg_has_role('postgres', 'supabase_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_FIXTURE_AUTHORITY_CHANGED';
  END IF;

  SELECT count(*) INTO v_remaining
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
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_DIRECT_GRANTS_REMAIN count=%', v_remaining;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl AS d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS acl
    WHERE acl.grantee IN (to_regrole('anon')::oid, to_regrole('authenticated')::oid)
      AND acl.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_BROWSER_DEFAULTS_REMAIN';
  END IF;

  IF has_table_privilege('anon', 'public.admins', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.admins', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.orders', 'SELECT')
     OR has_table_privilege('anon', 'public.payment_transactions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_transactions', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.payment_transactions', 'SELECT') THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_SAFE_GRANT_CONTRACT_CHANGED';
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
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_RLS_DISABLED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_transactions'
      AND policyname = 'admin_select_payment_transactions'
      AND cmd = 'SELECT' AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_FINAL_PAYMENT_ADMIN_POLICY_MISSING';
  END IF;
  RAISE NOTICE 'HOSTED_ACL_POSTGRES17_FINAL_STATE_PASS direct_acl=0 postgres_defaults=0 provider_defaults=0';
END;
$$;

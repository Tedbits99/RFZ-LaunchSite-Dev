-- Read-only post-migration assertions executed only against the isolated local
-- Supabase project after replaying the canonical active migrations and the
-- three exact RF Coins candidate migrations. No hosted database is targeted.
DO $$
DECLARE
  v_order_nullable boolean;
  v_order_fk_preserved boolean;
  v_topup_fk_present boolean;
  v_payment_rls boolean;
  v_payment_policy boolean;
  v_payment_indexes integer;
  v_release_locked boolean;
  v_feature_table_count integer;
  v_bad_rls_tables integer;
  v_has_wallet_method boolean;
  v_handoff_job boolean := false;
  v_handoff_secret_count bigint;
BEGIN
  IF to_regclass('public.payment_transactions') IS NULL
     OR to_regclass('public.rf_coin_wallets') IS NULL
     OR to_regclass('public.rf_coin_ledger') IS NULL
     OR to_regclass('public.rf_coin_topups') IS NULL
     OR to_regclass('public.rf_coin_fulfillment_handoffs') IS NULL THEN
    RAISE EXCEPTION 'RF_COINS_UPGRADED_SCHEMA_OBJECT_MISSING';
  END IF;

  SELECT NOT a.attnotnull INTO v_order_nullable
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.payment_transactions'::regclass
    AND a.attname = 'order_id' AND NOT a.attisdropped;
  IF v_order_nullable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RF_COINS_ORDER_ID_NOT_NULLABLE';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.payment_transactions'::regclass
      AND c.confrelid = 'public.orders'::regclass
      AND c.contype = 'f' AND c.confdeltype = 'c'
      AND a.attname = 'order_id' AND a.attnum = ANY(c.conkey)
  ) INTO v_order_fk_preserved;
  IF NOT v_order_fk_preserved THEN
    RAISE EXCEPTION 'RF_COINS_ORDER_PAYMENT_CASCADE_FK_NOT_PRESERVED';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid
    WHERE c.conrelid = 'public.payment_transactions'::regclass
      AND c.confrelid = 'public.rf_coin_topups'::regclass
      AND c.contype = 'f' AND c.confdeltype = 'n'
      AND a.attname = 'rf_coin_topup_id' AND a.attnum = ANY(c.conkey)
  ) INTO v_topup_fk_present;
  IF NOT v_topup_fk_present THEN
    RAISE EXCEPTION 'RF_COINS_TOPUP_PAYMENT_FK_MISSING';
  END IF;

  SELECT c.relrowsecurity INTO v_payment_rls
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.payment_transactions'::regclass;
  IF v_payment_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RF_COINS_PAYMENT_RLS_DISABLED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'payment_transactions'
      AND p.policyname = 'admin_select_payment_transactions'
      AND p.cmd = 'SELECT'
      AND 'authenticated' = ANY(p.roles)
      AND p.qual ILIKE '%is_admin%'
  ) INTO v_payment_policy;
  IF NOT v_payment_policy THEN
    RAISE EXCEPTION 'RF_COINS_PAYMENT_ADMIN_SELECT_POLICY_NOT_PRESERVED';
  END IF;

  SELECT count(*) INTO v_payment_indexes
  FROM pg_catalog.pg_class i
  WHERE i.relnamespace = 'public'::regnamespace
    AND i.relkind = 'i'
    AND i.relname IN (
      'idx_payment_tx_order_id', 'idx_payment_tx_provider_ref',
      'idx_payment_tx_idempotency', 'idx_payment_tx_rf_coin_topup'
    );
  IF v_payment_indexes <> 4 THEN
    RAISE EXCEPTION 'RF_COINS_PAYMENT_INDEX_COMPATIBILITY_FAILURE';
  END IF;

  SELECT count(*) INTO v_feature_table_count
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'rf_coin_settings', 'rf_coin_wallets', 'rf_coin_ledger',
      'rf_coin_packages', 'rf_coin_topups', 'rf_coin_adjustment_requests',
      'rf_coin_admin_audit', 'rf_coin_fulfillment_handoffs'
    );
  IF v_feature_table_count <> 8 THEN
    RAISE EXCEPTION 'RF_COINS_EXPECTED_FEATURE_TABLE_COUNT_MISMATCH';
  END IF;

  SELECT count(*) INTO v_bad_rls_tables
  FROM pg_catalog.pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind IN ('r', 'p')
    AND c.relname IN (
      'rf_coin_settings', 'rf_coin_wallets', 'rf_coin_ledger',
      'rf_coin_packages', 'rf_coin_topups', 'rf_coin_adjustment_requests',
      'rf_coin_admin_audit', 'rf_coin_fulfillment_handoffs'
    )
    AND NOT c.relrowsecurity;
  IF v_bad_rls_tables <> 0 THEN
    RAISE EXCEPTION 'RF_COINS_RLS_NOT_ENABLED_ON_ALL_FEATURE_TABLES';
  END IF;

  SELECT NOT enabled AND NOT topups_enabled AND NOT spending_enabled
  INTO v_release_locked
  FROM public.rf_coin_settings WHERE id = 1;
  IF v_release_locked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RF_COINS_RELEASE_FLAGS_NOT_DISABLED';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.payment_config
    WHERE method_key = 'rf_coin_wallet' AND is_enabled IS TRUE
  ) INTO v_has_wallet_method;
  IF v_has_wallet_method THEN
    RAISE EXCEPTION 'RF_COINS_WALLET_PAYMENT_METHOD_ENABLED';
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1)'
      INTO v_handoff_job USING 'fulfillment-handoff';
  END IF;
  IF v_handoff_job THEN
    RAISE EXCEPTION 'RF_COINS_FULFILLMENT_JOB_WAS_SCHEDULED';
  END IF;

  SELECT count(*) INTO v_handoff_secret_count
  FROM public._cron_secrets WHERE key = 'fulfillment_handoff_secret';
  IF v_handoff_secret_count <> 0 THEN
    RAISE EXCEPTION 'RF_COINS_FULFILLMENT_SECRET_WAS_CREATED';
  END IF;

  IF has_function_privilege('anon', 'public.rf_coin_credit_paid_topup(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.rf_coin_credit_paid_topup(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rf_coin_admin_center_read(text,integer,integer,uuid,timestamp with time zone,timestamp with time zone,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'RF_COINS_PRIVILEGED_RPC_GRANTS_TOO_BROAD';
  END IF;

  RAISE NOTICE 'RF_COINS_FULL_CURRENT_SCHEMA_UPGRADE_PASS order_fk=preserved topup_fk=present payment_rls=enabled admin_policy=preserved indexes=4 release_locks=off handoff_job=absent handoff_secret=absent';
END;
$$;

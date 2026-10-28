\set ON_ERROR_STOP on

-- Minimal, disposable PostgreSQL 17 catalog fixture for the hosted ACL
-- remediation. Run only in the standalone throwaway PG container.
DO $$
BEGIN
  IF current_user <> 'postgres' OR NOT (
    SELECT rolsuper FROM pg_roles WHERE rolname = current_user
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_FIXTURE_REQUIRES_DISPOSABLE_SUPERUSER';
  END IF;
END;
$$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN;

CREATE SCHEMA storage;
CREATE SCHEMA graphql;
CREATE SCHEMA graphql_public;

DO $$
DECLARE
  v_table text;
BEGIN
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
    EXECUTE format('CREATE TABLE public.%I (id bigint PRIMARY KEY)', v_table);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END;
$$;

GRANT SELECT ON public.payment_transactions TO service_role;
GRANT SELECT ON public.admins, public.orders TO authenticated;
CREATE POLICY admin_select_payment_transactions
  ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (true);

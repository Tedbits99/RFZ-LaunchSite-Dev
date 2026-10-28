\set ON_ERROR_STOP on

-- Disposable PostgreSQL 17 fixture. `bootstrap` is the throwaway container's
-- setup superuser; the migrations are later executed over a separate
-- connection as a NOSUPERUSER `postgres` role, matching hosted authority.
DO $$
BEGIN
  IF current_user <> 'bootstrap' OR NOT (
    SELECT rolsuper FROM pg_roles WHERE rolname = current_user
  ) THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_FIXTURE_REQUIRES_DISPOSABLE_BOOTSTRAP';
  END IF;
END;
$$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE postgres LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE supabase_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE SCHEMA storage AUTHORIZATION postgres;
CREATE SCHEMA graphql AUTHORIZATION supabase_admin;
CREATE SCHEMA graphql_public AUTHORIZATION supabase_admin;
GRANT USAGE, CREATE ON SCHEMA public TO postgres, supabase_admin;

SET ROLE postgres;
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

-- Preserve representative safe grants and policy behavior across the change.
GRANT SELECT ON public.payment_transactions TO service_role;
GRANT SELECT ON public.admins, public.orders TO authenticated;
CREATE POLICY admin_select_payment_transactions
  ON public.payment_transactions
  FOR SELECT TO authenticated
  USING (true);

-- Reproduce the exact 204 direct excess ACL entries from audit 40639888077.
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.announcements, public.app_settings, public.email_sent_log,
  public.game_input_fields, public.games, public.global_announcement,
  public.notifications, public.order_notes, public.packages, public.payment_config,
  public.payment_submissions, public.payment_transactions, public.player_cache,
  public.promotions, public.refunds, public.supplier_package_mappings,
  public.supplier_test_runs, public.suppliers, public.support_messages,
  public.support_tickets, public.verification_attempts, public.verified_users,
  public.voucher_usages, public.vouchers
TO anon, authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.admins, public.order_timeline, public.orders
TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
RESET ROLE;

-- Create the provider-owned defaults as their actual non-superuser owner.
-- `postgres` is not a member of `supabase_admin`; the next test must fail
-- rather than acquiring or emulating this role.
SET ROLE supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public
  GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated;
RESET ROLE;

DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres')
     OR pg_has_role('postgres', 'supabase_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'HOSTED_ACL_REHEARSAL_ROLE_AUTHORITY_FIXTURE_INVALID';
  END IF;
  RAISE NOTICE 'HOSTED_ACL_NON_SUPERUSER_AUTHORITY_FIXTURE_PASS';
END;
$$;

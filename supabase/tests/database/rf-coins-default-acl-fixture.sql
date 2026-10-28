-- DISPOSABLE PostgreSQL 17 fixture only. The upgrade harness invokes this
-- against its unlinked, loopback-only Supabase database before applying the
-- pending RF Coins migrations. It mirrors the excessive table defaults
-- reported for the hosted project and proves the fixture is effective before
-- exercising the migration's explicit per-table revokes.
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RF_COINS_DEFAULT_ACL_FIXTURE_WRONG_OWNER';
  END IF;
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000 THEN
    RAISE EXCEPTION 'RF_COINS_POSTGRESQL_17_REQUIRED';
  END IF;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;

CREATE TABLE public.rfz_acl_default_privilege_probe (id integer PRIMARY KEY);

DO $$
DECLARE
  v_role text;
  v_privilege text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ] LOOP
      IF NOT has_table_privilege(v_role, 'public.rfz_acl_default_privilege_probe', v_privilege) THEN
        RAISE EXCEPTION 'RF_COINS_DEFAULT_ACL_FIXTURE_INCOMPLETE role=% privilege=%',
          v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

DROP TABLE public.rfz_acl_default_privilege_probe;

DO $$
BEGIN
  IF to_regclass('public.rfz_acl_default_privilege_probe') IS NOT NULL THEN
    RAISE EXCEPTION 'RF_COINS_DEFAULT_ACL_FIXTURE_PROBE_NOT_REMOVED';
  END IF;
  RAISE NOTICE 'RF_COINS_POSTGRES17_DEFAULT_ACL_FIXTURE_PASS';
END;
$$;

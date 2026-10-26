-- Run only in the owner-authorized SQL Editor/connection for project
-- ketdhcmwowzztcdlmris. This file is intentionally SELECT-only.
-- It must never be used with `supabase db push`, migrations, or reset.

-- 1. Migration ledger and project-level object inventory.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('supabase_migrations', 'cron', 'net', 'vault')
ORDER BY table_schema, table_name;

SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

SELECT n.nspname AS schema_name,
       c.relname AS object_name,
       CASE c.relkind
         WHEN 'r' THEN 'table'
         WHEN 'p' THEN 'partitioned_table'
         WHEN 'v' THEN 'view'
         WHEN 'm' THEN 'materialized_view'
         WHEN 'S' THEN 'sequence'
         ELSE c.relkind::text
       END AS object_type,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname;

-- 2. Columns, defaults, and constraints for the application schema.
SELECT table_name, ordinal_position, column_name, data_type,
       udt_schema, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT con.conname AS constraint_name,
       ns.nspname AS schema_name,
       cls.relname AS table_name,
       con.contype AS constraint_type,
       pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
ORDER BY cls.relname, con.conname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 3. RLS policies and effective table privileges. No row data is selected.
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT table_schema, table_name, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'service_role', 'public')
ORDER BY table_name, grantee, privilege_type;

-- 4. Functions, SECURITY DEFINER/search_path, and EXECUTE grants.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,
       p.prosecdef AS security_definer,
       p.proconfig AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, arguments;

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       length(pg_catalog.pg_get_functiondef(p.oid)) AS definition_length,
       pg_catalog.pg_get_functiondef(p.oid) ~* '(service_role|anon_key|secret|token|password|api[_ -]?key|https?://)' AS definition_needs_local_review
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'finalize_supplier_reconciliation',
    'claim_completion_receipt',
    'ack_completion_receipt',
    'fail_completion_receipt',
    'admin_change_order_status',
    'admin_get_all_games',
    'admin_set_game_active'
  )
ORDER BY p.proname, arguments;

-- 5. Triggers, Realtime membership, extensions, and scheduled-job metadata.
SELECT event_object_schema, event_object_table, trigger_name,
       event_manipulation, action_statement, action_timing
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name;

SELECT pubname, schemaname, tablename
FROM pg_catalog.pg_publication_tables
ORDER BY pubname, schemaname, tablename;

SELECT extname, extversion
FROM pg_catalog.pg_extension
ORDER BY extname;

SELECT to_regclass('cron.job') AS cron_job_relation,
       to_regclass('net.http_request_queue') AS net_request_queue_relation,
       to_regclass('vault.secrets') AS vault_secrets_relation;

-- If cron.job exists, run this metadata-only SELECT in the same read-only
-- session. Never export command text: it can contain URLs or credentials.
-- SELECT jobid, schedule, active, length(command) AS command_length,
--        command ~* '(secret|token|password|api[_ -]?key|https?://)' AS command_needs_local_review
-- FROM cron.job ORDER BY jobid;

-- 6. Integration-specific object presence only; no customer or secret values.
SELECT object_name,
       to_regclass('public.' || object_name) IS NOT NULL AS present
FROM (VALUES
  ('payment_config'), ('payment_submissions'), ('payment_transactions'),
  ('supplier_transactions'), ('supplier_test_runs'), ('order_email_outbox'),
  ('email_sent_log'), ('guest_order_access'), ('customer_profiles'),
  ('rf_coin_wallets'), ('rf_coin_ledger'), ('rf_coin_topups')
) AS expected(object_name)
ORDER BY object_name;


-- Read-only hosted Gate B authorization assertions.
-- This transaction never invokes commerce, payment, supplier, wallet, email,
-- webhook, or reconciliation mutations.

BEGIN;

DO $$
DECLARE
  fn text;
  service_only text[] := ARRAY[
    'public.submit_payment(text,text,text,text,text,text)',
    'public.set_supplier_credential(text,text,text)',
    'public.get_supplier_credential(text,text)',
    'public.finalize_supplier_reconciliation(uuid,text,text,text)',
    'public.claim_completion_receipt_outbox(integer,integer)',
    'public.ack_completion_receipt_sent(uuid,uuid,text)',
    'public.fail_completion_receipt_outbox(uuid,uuid,text)',
    'public.archive_old_unpaid_orders()'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure::text
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' ESCAPE '\'
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'HOSTED_ANON_ADMIN_EXECUTE:%', fn;
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY service_only LOOP
    IF to_regprocedure(fn) IS NOT NULL
       AND (has_function_privilege('anon', fn, 'EXECUTE')
            OR has_function_privilege('authenticated', fn, 'EXECUTE')) THEN
      RAISE EXCEPTION 'HOSTED_CLIENT_SERVICE_RPC_EXECUTE:%', fn;
    END IF;
  END LOOP;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000099"}',
  true
);

DO $$
DECLARE
  fn text;
  read_only_admin text[] := ARRAY[
    'public.admin_get_all_games()',
    'public.admin_get_all_payment_config()',
    'public.admin_get_games_with_package_counts()'
  ];
BEGIN
  FOREACH fn IN ARRAY read_only_admin LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE EXCEPTION 'HOSTED_REQUIRED_ADMIN_RPC_MISSING:%', fn;
    END IF;
    BEGIN
      EXECUTE format('SELECT 1 FROM %s LIMIT 1', fn);
      RAISE EXCEPTION 'HOSTED_NONADMIN_ADMIN_RPC_EXECUTED:%', fn;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
      WHEN raise_exception THEN
        IF SQLERRM <> 'FORBIDDEN' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

RESET ROLE;
ROLLBACK;

SELECT 'HOSTED_PRIVILEGED_RPC_AUDIT_PASS' AS result;

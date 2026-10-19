\set ON_ERROR_STOP on

-- Disposable PostgreSQL assertions for the completion-receipt worker boundary.
-- The harness races the final fixture row from two independent psql sessions.

INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, sort_order)
VALUES ('00000000-0000-0000-0000-000000000602', 'outbox-worker-game', 'Outbox Worker Game', 'OWG', 'Disposable fixture', 'Test', 'PHP', true, 2602);

INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, sort_order)
VALUES ('00000000-0000-0000-0000-000000000603', '00000000-0000-0000-0000-000000000602', 'Outbox Worker Package', 'OUTBOX-WORKER', '1', 1, 2602);

INSERT INTO public.orders (
  id, reference, email, customer_name, game_id, package_id, player_inputs,
  subtotal_cents, discount_cents, fee_cents, total_cents, payment_method,
  status, payment_status, fulfillment_status, quantity
)
VALUES
  ('00000000-0000-0000-0000-000000000604', 'OUTBOX-WORKER-1', 'worker-1@example.invalid', 'Worker Test', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000603', jsonb_build_object('user_id', '1234', '__rfz_order_access_hash', repeat('a', 64)), 1, 0, 0, 1, 'manual', 'COMPLETED', 'VERIFIED', 'COMPLETED', 1),
  ('00000000-0000-0000-0000-000000000605', 'OUTBOX-WORKER-2', 'worker-2@example.invalid', 'Worker Test', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000603', jsonb_build_object('user_id', '1234', '__rfz_order_access_hash', repeat('b', 64)), 1, 0, 0, 1, 'manual', 'COMPLETED', 'VERIFIED', 'COMPLETED', 1),
  ('00000000-0000-0000-0000-000000000606', 'OUTBOX-WORKER-3', 'worker-3@example.invalid', 'Worker Test', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000603', jsonb_build_object('user_id', '1234', '__rfz_order_access_hash', repeat('c', 64)), 1, 0, 0, 1, 'manual', 'COMPLETED', 'VERIFIED', 'COMPLETED', 1),
  ('00000000-0000-0000-0000-000000000607', 'OUTBOX-WORKER-RACE', 'worker-race@example.invalid', 'Worker Test', '00000000-0000-0000-0000-000000000602', '00000000-0000-0000-0000-000000000603', jsonb_build_object('user_id', '1234', '__rfz_order_access_hash', repeat('d', 64)), 1, 0, 0, 1, 'manual', 'COMPLETED', 'VERIFIED', 'COMPLETED', 1);

INSERT INTO public.suppliers (id, name, code, adapter, enabled, environment)
VALUES ('00000000-0000-0000-0000-000000000613', 'Outbox Worker Test Supplier', 'fazercards', 'custom', true, 'sandbox');

INSERT INTO public.supplier_transactions (
  id, order_id, supplier_id, idempotency_key, action, status, supplier_reference
)
VALUES
  ('00000000-0000-0000-0000-000000000614', '00000000-0000-0000-0000-000000000604', '00000000-0000-0000-0000-000000000613', 'outbox-worker-1', 'create_order', 'success', 'synthetic-1'),
  ('00000000-0000-0000-0000-000000000615', '00000000-0000-0000-0000-000000000605', '00000000-0000-0000-0000-000000000613', 'outbox-worker-2', 'create_order', 'success', 'synthetic-2'),
  ('00000000-0000-0000-0000-000000000616', '00000000-0000-0000-0000-000000000606', '00000000-0000-0000-0000-000000000613', 'outbox-worker-3', 'create_order', 'success', 'synthetic-3'),
  ('00000000-0000-0000-0000-000000000617', '00000000-0000-0000-0000-000000000607', '00000000-0000-0000-0000-000000000613', 'outbox-worker-race', 'create_order', 'success', 'synthetic-race');

INSERT INTO public.order_email_outbox (id, order_id, template, recipient_email)
VALUES
  ('00000000-0000-0000-0000-000000000608', '00000000-0000-0000-0000-000000000604', 'completion_receipt', 'worker-1@example.invalid'),
  ('00000000-0000-0000-0000-000000000609', '00000000-0000-0000-0000-000000000605', 'completion_receipt', 'worker-2@example.invalid'),
  ('00000000-0000-0000-0000-000000000610', '00000000-0000-0000-0000-000000000606', 'completion_receipt', 'worker-3@example.invalid'),
  ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000607', 'completion_receipt', 'worker-race@example.invalid');

WITH stamped AS (
  SELECT id, clock_timestamp() AS completed_at
  FROM public.order_email_outbox
  WHERE id IN (
    '00000000-0000-0000-0000-000000000608',
    '00000000-0000-0000-0000-000000000609',
    '00000000-0000-0000-0000-000000000610',
    '00000000-0000-0000-0000-000000000611'
  )
)
UPDATE public.order_email_outbox AS outbox
SET completed_at = stamped.completed_at,
    receipt_snapshot = jsonb_build_object(
      'reference', orders.reference,
      'total_cents', orders.total_cents,
      'payment_method', orders.payment_method,
      'game_name', games.name,
      'package_name', packages.name,
      'quantity', orders.quantity,
      'masked_player_identifier', '****1234',
      'completed_at', stamped.completed_at
    )
FROM stamped
  , public.orders
  , public.games
  , public.packages
WHERE outbox.id = stamped.id
  AND orders.id = outbox.order_id
  AND games.id = orders.game_id
  AND packages.id = orders.package_id;

UPDATE public.order_email_outbox
SET next_attempt_at = clock_timestamp() + interval '1 hour'
WHERE id IN ('00000000-0000-0000-0000-000000000610', '00000000-0000-0000-0000-000000000611');

DO $$
DECLARE
  v_claim record;
  v_claim_count integer;
  v_old_token uuid;
  v_status text;
  v_legacy_status text;
  v_legacy_attempt_count integer;
  v_legacy_lease_token uuid;
  v_legacy_lease_until timestamptz;
  v_next timestamptz;
  v_fn text;
  v_valid_snapshot jsonb;
  v_positive_snapshot jsonb;
  v_bad_snapshot jsonb;
  v_valid_claimed boolean;
  v_bad_claimed boolean;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.claim_completion_receipt_outbox(integer,integer)',
    'public.ack_completion_receipt_sent(uuid,uuid,text)',
    'public.fail_completion_receipt_outbox(uuid,uuid,text)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'OUTBOX_WORKER_RPC_PRIVILEGE_INVALID: %', v_fn;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.order_email_outbox', 'UPDATE') THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_DIRECT_UPDATE_PRIVILEGE_INVALID';
  END IF;

  SELECT count(*) INTO v_claim_count FROM public.claim_completion_receipt_outbox(1, 60);
  IF v_claim_count <> 1 THEN RAISE EXCEPTION 'OUTBOX_WORKER_CLAIM_COUNT_INVALID'; END IF;
  SELECT * INTO v_claim FROM public.order_email_outbox WHERE status = 'processing' AND id <> '00000000-0000-0000-0000-000000000611';
  v_old_token := v_claim.lease_token;
  IF v_old_token IS NULL OR v_claim.attempt_count <> 1 OR v_claim.lease_until <= clock_timestamp()
     OR jsonb_typeof(v_claim.receipt_snapshot) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(v_claim.receipt_snapshot)) <> 8
     OR v_claim.receipt_snapshot->>'reference' <> 'OUTBOX-WORKER-1'
     OR (v_claim.receipt_snapshot->>'total_cents')::integer <> 1
     OR v_claim.receipt_snapshot->>'payment_method' <> 'manual'
     OR (v_claim.receipt_snapshot->>'quantity')::integer <> 1
     OR v_claim.receipt_snapshot->>'game_name' <> 'Outbox Worker Game'
     OR v_claim.receipt_snapshot->>'package_name' <> 'Outbox Worker Package'
     OR v_claim.receipt_snapshot->'completed_at' <> to_jsonb(v_claim.completed_at) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_LEASE_INVALID';
  END IF;

  IF NOT public.ack_completion_receipt_sent(v_claim.id, v_old_token, repeat('provider-', 100))
     OR public.ack_completion_receipt_sent(v_claim.id, v_old_token, 'duplicate') THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_ACK_IDEMPOTENCY_INVALID';
  END IF;
  IF (SELECT char_length(provider_message_id) FROM public.order_email_outbox WHERE id = v_claim.id) <> 500 THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_PROVIDER_ID_BOUND_INVALID';
  END IF;

  -- A retryable error is sanitized, bounded, and delayed exponentially.
  SELECT * INTO v_claim FROM public.claim_completion_receipt_outbox(1, 60);
  SELECT * INTO v_claim FROM public.order_email_outbox WHERE status = 'processing' AND id NOT IN ('00000000-0000-0000-0000-000000000611');
  SELECT out_status, out_next_attempt_at INTO v_status, v_next
  FROM public.fail_completion_receipt_outbox(
    v_claim.id, v_claim.lease_token,
    'PROVIDER_REJECTED token=secret-token payment_secret=private player=123456789'
  );
  IF v_status <> 'pending' OR v_next <= clock_timestamp() OR v_next > clock_timestamp() + interval '16 minutes' THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_RETRY_BACKOFF_INVALID';
  END IF;
  IF (SELECT last_error FROM public.order_email_outbox WHERE id = v_claim.id) <> 'unclassified'
     OR (SELECT last_error FROM public.order_email_outbox WHERE id = v_claim.id)
       LIKE '%secret-token%'
     OR (SELECT last_error FROM public.order_email_outbox WHERE id = v_claim.id)
       LIKE '%123456789%' THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_ERROR_PRIVACY_INVALID';
  END IF;

  UPDATE public.order_email_outbox
  SET next_attempt_at = clock_timestamp() + interval '1 hour'
  WHERE id = v_claim.id;
  UPDATE public.order_email_outbox
  SET next_attempt_at = clock_timestamp()
  WHERE id = v_claim.id;
  SELECT * INTO v_claim FROM public.claim_completion_receipt_outbox(1, 60);
  SELECT * INTO v_claim FROM public.order_email_outbox WHERE status = 'processing'
    AND id <> '00000000-0000-0000-0000-000000000611';
  SELECT out_status INTO v_status
  FROM public.fail_completion_receipt_outbox(v_claim.id, v_claim.lease_token, 'TIMEOUT');
  IF v_status <> 'pending'
     OR (SELECT last_error FROM public.order_email_outbox WHERE id = v_claim.id) <> 'delivery_timeout' THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_ALLOWLISTED_ERROR_CATEGORY_INVALID';
  END IF;

  SELECT receipt_snapshot INTO v_valid_snapshot
  FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000609';
  SELECT receipt_snapshot INTO v_positive_snapshot
  FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000608';

  -- Each malformed root remains otherwise eligible, while a genuine E5.1
  -- snapshot is made eligible in the same claim batch as a positive control.
  -- This proves malformed roots do not throw and do not mask valid work.
  FOR v_bad_snapshot IN
    SELECT '[]'::jsonb
    UNION ALL SELECT '"not-an-object"'::jsonb
    UNION ALL SELECT '42'::jsonb
    UNION ALL SELECT 'true'::jsonb
    UNION ALL SELECT 'null'::jsonb
  LOOP
    UPDATE public.order_email_outbox
    SET status = 'pending', attempt_count = 0, lease_token = NULL,
        lease_until = NULL, next_attempt_at = clock_timestamp(),
        receipt_snapshot = v_bad_snapshot
    WHERE id = '00000000-0000-0000-0000-000000000609';
    UPDATE public.order_email_outbox
    SET status = 'pending', attempt_count = 0, lease_token = NULL,
        lease_until = NULL, next_attempt_at = clock_timestamp(),
        receipt_snapshot = v_positive_snapshot
    WHERE id = '00000000-0000-0000-0000-000000000608';

    SELECT
      COALESCE(bool_or(out_id = '00000000-0000-0000-0000-000000000608'), false),
      COALESCE(bool_or(out_id = '00000000-0000-0000-0000-000000000609'), false)
    INTO v_valid_claimed, v_bad_claimed
    FROM public.claim_completion_receipt_outbox(100, 30);

    IF NOT v_valid_claimed OR v_bad_claimed THEN
      RAISE EXCEPTION 'OUTBOX_WORKER_NON_OBJECT_ROOT_HANDLING_INVALID: %', v_bad_snapshot;
    END IF;

    UPDATE public.order_email_outbox
    SET status = 'sent', attempt_count = 1, lease_token = NULL,
        lease_until = NULL, sent_at = clock_timestamp()
    WHERE id = '00000000-0000-0000-0000-000000000608';
  END LOOP;

  -- receipt_snapshot is NOT NULL, so SQL NULL cannot reach claim eligibility.
  BEGIN
    UPDATE public.order_email_outbox
    SET receipt_snapshot = NULL
    WHERE id = '00000000-0000-0000-0000-000000000609';
    RAISE EXCEPTION 'OUTBOX_WORKER_SQL_NULL_SNAPSHOT_ACCEPTED';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;

  UPDATE public.order_email_outbox
  SET status = 'pending', attempt_count = 0, lease_token = NULL,
      lease_until = NULL, next_attempt_at = clock_timestamp(),
      receipt_snapshot = v_valid_snapshot
  WHERE id = '00000000-0000-0000-0000-000000000609';

  FOR v_bad_snapshot IN
    SELECT v_valid_snapshot - 'package_name'
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{reference}', 'null'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{reference}', '"   "'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{total_cents}', '"1"'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{total_cents}', '2'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{payment_method}', '""'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{game_name}', 'true'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{package_name}', '"   "'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{quantity}', '0'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{quantity}', '2'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{quantity}', '"1"'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{masked_player_identifier}', 'null'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{masked_player_identifier}', '"123456789"'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{completed_at}', '"not-a-timestamp"'::jsonb)
    UNION ALL SELECT jsonb_set(v_valid_snapshot, '{reference}', '"OTHER-ORDER"'::jsonb)
    UNION ALL SELECT v_valid_snapshot || jsonb_build_object('raw_player_identifier', '123456789')
  LOOP
    UPDATE public.order_email_outbox
    SET receipt_snapshot = v_bad_snapshot, next_attempt_at = clock_timestamp()
    WHERE id = '00000000-0000-0000-0000-000000000609';
    IF EXISTS (
      SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
      WHERE out_id = '00000000-0000-0000-0000-000000000609'
    ) THEN
      RAISE EXCEPTION 'OUTBOX_WORKER_MALFORMED_SNAPSHOT_CLAIMED';
    END IF;
  END LOOP;
  UPDATE public.order_email_outbox
  SET receipt_snapshot = v_valid_snapshot,
      recipient_email = '   ',
      next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_BLANK_RECIPIENT_CLAIMED';
  END IF;
  UPDATE public.order_email_outbox
  SET recipient_email = 'different@example.invalid', next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_RECIPIENT_MISMATCH_CLAIMED';
  END IF;
  UPDATE public.order_email_outbox
  SET recipient_email = 'invalid-address', next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  UPDATE public.orders SET email = 'invalid-address'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_MALFORMED_RECIPIENT_CLAIMED';
  END IF;
  UPDATE public.orders SET email = 'worker-2@example.invalid'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  UPDATE public.order_email_outbox
  SET recipient_email = 'worker-2@example.invalid',
      receipt_snapshot = jsonb_set(v_valid_snapshot, '{total_cents}', 'null'::jsonb),
      next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_JSON_NULL_CLAIMED';
  END IF;
  UPDATE public.order_email_outbox
  SET receipt_snapshot = v_valid_snapshot
  WHERE id = '00000000-0000-0000-0000-000000000609';
  UPDATE public.orders SET payment_status = 'UNPAID'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  UPDATE public.order_email_outbox SET next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_UNVERIFIED_PAYMENT_CLAIMED';
  END IF;
  UPDATE public.orders SET payment_status = 'VERIFIED'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  UPDATE public.supplier_transactions SET status = 'pending'
  WHERE id = '00000000-0000-0000-0000-000000000615';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_UNCONFIRMED_SUPPLIER_CLAIMED';
  END IF;
  UPDATE public.supplier_transactions SET status = 'success'
  WHERE id = '00000000-0000-0000-0000-000000000615';
  UPDATE public.orders SET status = 'PROCESSING', fulfillment_status = 'PROCESSING'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  UPDATE public.order_email_outbox SET next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (
    SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30)
    WHERE out_id = '00000000-0000-0000-0000-000000000609'
  ) THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_INCOMPLETE_ORDER_CLAIMED';
  END IF;
  UPDATE public.orders SET status = 'COMPLETED', fulfillment_status = 'COMPLETED'
  WHERE id = '00000000-0000-0000-0000-000000000605';
  UPDATE public.order_email_outbox
  SET next_attempt_at = clock_timestamp() + interval '1 hour'
  WHERE id = '00000000-0000-0000-0000-000000000609';

  -- An expired lease is recoverable and receives a new token.
  UPDATE public.order_email_outbox SET status = 'processing', attempt_count = 1,
    lease_token = gen_random_uuid(), lease_until = clock_timestamp() - interval '1 second'
  WHERE id = '00000000-0000-0000-0000-000000000610';
  SELECT lease_token INTO v_old_token FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000610';
  SELECT * INTO v_claim FROM public.claim_completion_receipt_outbox(1, 30);
  IF v_claim.out_id <> '00000000-0000-0000-0000-000000000610' OR v_claim.out_lease_token = v_old_token OR v_claim.out_attempt_count <> 2 THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_LEASE_RECOVERY_INVALID';
  END IF;
  IF public.ack_completion_receipt_sent(v_claim.out_id, v_old_token, 'stale') THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_STALE_ACK_ACCEPTED';
  END IF;

  -- Fifth claim failure dead-letters and is never claimable again.
  UPDATE public.order_email_outbox SET status = 'processing', attempt_count = 5,
    lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '1 minute'
  WHERE id = '00000000-0000-0000-0000-000000000610';
  SELECT lease_token INTO v_old_token FROM public.order_email_outbox WHERE id = '00000000-0000-0000-0000-000000000610';
  SELECT out_status INTO v_status FROM public.fail_completion_receipt_outbox('00000000-0000-0000-0000-000000000610', v_old_token, 'final failure');
  IF v_status <> 'dead_letter' THEN RAISE EXCEPTION 'OUTBOX_WORKER_DEAD_LETTER_INVALID'; END IF;

  -- Compatibility: legacy values above the new retry ceiling are preserved,
  -- lazily quarantined on claim, and are never rewritten or sent.
  UPDATE public.order_email_outbox
  SET status = 'pending', attempt_count = 7, lease_token = NULL,
      lease_until = NULL, next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000610';
  SELECT count(*) INTO v_claim_count
  FROM public.claim_completion_receipt_outbox(100, 30)
  WHERE out_id = '00000000-0000-0000-0000-000000000610';
  IF v_claim_count > 0 THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_EXHAUSTED_RECEIPT_CLAIMED';
  END IF;

  SELECT status, attempt_count, lease_token, lease_until
  INTO v_legacy_status, v_legacy_attempt_count, v_legacy_lease_token, v_legacy_lease_until
  FROM public.order_email_outbox
  WHERE id = '00000000-0000-0000-0000-000000000610';
  IF v_legacy_status IS DISTINCT FROM 'dead_letter' THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_EXHAUSTED_RECEIPT_NOT_QUARANTINED';
  END IF;
  IF v_legacy_attempt_count IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_HISTORICAL_ATTEMPT_COUNT_REWRITTEN';
  END IF;
  IF v_legacy_lease_token IS NOT NULL OR v_legacy_lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_EXHAUSTED_RECEIPT_LEASE_NOT_CLEARED';
  END IF;

  -- Invalid snapshots and recipients are excluded from claims.
  UPDATE public.order_email_outbox SET status = 'pending', recipient_email = 'worker-2@example.invalid', receipt_snapshot = '{}'::jsonb,
    next_attempt_at = clock_timestamp()
  WHERE id = '00000000-0000-0000-0000-000000000609';
  IF EXISTS (SELECT 1 FROM public.claim_completion_receipt_outbox(100, 30) WHERE out_id = '00000000-0000-0000-0000-000000000609') THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_INVALID_RECEIPT_CLAIMED';
  END IF;
  BEGIN
    UPDATE public.order_email_outbox SET recipient_email = NULL
    WHERE id = '00000000-0000-0000-0000-000000000609';
    RAISE EXCEPTION 'OUTBOX_WORKER_MISSING_RECIPIENT_ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.order_email_outbox'::regclass AND conname = 'order_email_outbox_order_template_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'OUTBOX_WORKER_UNIQUENESS_CHANGED';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.test_outbox_worker_race_barrier()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.id = '00000000-0000-0000-0000-000000000611'
     AND NEW.status = 'processing' THEN
    PERFORM pg_advisory_lock(180018, 1);
    PERFORM pg_advisory_xact_lock(180018, 2);
    PERFORM pg_advisory_unlock(180018, 1);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS outbox_worker_race_barrier ON public.order_email_outbox;
CREATE TRIGGER outbox_worker_race_barrier
BEFORE UPDATE ON public.order_email_outbox
FOR EACH ROW
WHEN (NEW.id = '00000000-0000-0000-0000-000000000611' AND NEW.status = 'processing')
EXECUTE FUNCTION public.test_outbox_worker_race_barrier();

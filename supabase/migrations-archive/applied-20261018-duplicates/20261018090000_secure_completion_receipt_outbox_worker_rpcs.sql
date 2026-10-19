-- ALREADY APPLIED to live database as: 20261018152627_20261018090000_secure_completion_receipt_outbox_worker_rpcs.sql
-- Do not re-execute this original file. Kept for history only.

-- Secure completion-receipt outbox worker boundary.
--
-- This migration adds database-only claim/acknowledgement primitives. It does
-- not send mail, schedule work, or change the completion boundary.

ALTER TABLE public.order_email_outbox
  ADD COLUMN IF NOT EXISTS lease_token uuid;

REVOKE UPDATE ON TABLE public.order_email_outbox FROM service_role;
REVOKE UPDATE (
  status,
  attempt_count,
  next_attempt_at,
  lease_until,
  provider_message_id,
  last_error,
  sent_at,
  lease_token
) ON TABLE public.order_email_outbox FROM service_role;

CREATE OR REPLACE FUNCTION public.claim_completion_receipt_outbox(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(
  out_id uuid,
  out_order_id uuid,
  out_recipient_email text,
  out_receipt_snapshot jsonb,
  out_attempt_count integer,
  out_lease_token uuid,
  out_lease_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 900);
BEGIN
  -- Expired leases are recoverable. Rows that have exhausted their bounded
  -- attempts are quarantined and are never returned to a worker.
  UPDATE public.order_email_outbox
    SET status = 'dead_letter',
      lease_until = NULL,
      lease_token = NULL,
      last_error = 'Maximum receipt delivery attempts exceeded'
  WHERE template = 'completion_receipt'
    AND attempt_count >= 5
    AND (
      status = 'pending'
      OR (status = 'processing' AND (lease_until IS NULL
          OR lease_until <= clock_timestamp()))
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.order_email_outbox AS o
    JOIN public.orders AS ord ON ord.id = o.order_id
    WHERE o.template = 'completion_receipt'
      AND o.attempt_count < 5
      AND (
        (o.status = 'pending' AND o.next_attempt_at <= clock_timestamp())
        OR (o.status = 'processing' AND (o.lease_until IS NULL
            OR o.lease_until <= clock_timestamp()))
      )
      AND o.recipient_email IS NOT NULL
      AND btrim(o.recipient_email) <> ''
      AND o.recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND CASE
        WHEN jsonb_typeof(o.receipt_snapshot) = 'object'
          THEN (
            SELECT count(*) = 8
            FROM jsonb_object_keys(o.receipt_snapshot)
          )
        ELSE false
      END
      AND jsonb_typeof(o.receipt_snapshot->'reference') = 'string'
      AND NULLIF(btrim(o.receipt_snapshot->>'reference'), '') IS NOT NULL
      AND o.receipt_snapshot->>'reference' = ord.reference
      AND jsonb_typeof(o.receipt_snapshot->'total_cents') = 'number'
      AND o.receipt_snapshot->>'total_cents' ~ '^[1-9][0-9]*$'
      AND o.receipt_snapshot->'total_cents' = to_jsonb(ord.total_cents)
      AND jsonb_typeof(o.receipt_snapshot->'payment_method') = 'string'
      AND NULLIF(btrim(o.receipt_snapshot->>'payment_method'), '') IS NOT NULL
      AND o.receipt_snapshot->>'payment_method' = ord.payment_method
      AND jsonb_typeof(o.receipt_snapshot->'game_name') = 'string'
      AND NULLIF(btrim(o.receipt_snapshot->>'game_name'), '') IS NOT NULL
      AND jsonb_typeof(o.receipt_snapshot->'package_name') = 'string'
      AND NULLIF(btrim(o.receipt_snapshot->>'package_name'), '') IS NOT NULL
      AND jsonb_typeof(o.receipt_snapshot->'quantity') = 'number'
      AND o.receipt_snapshot->>'quantity' ~ '^[1-9][0-9]*$'
      AND o.receipt_snapshot->'quantity' = to_jsonb(ord.quantity)
      AND jsonb_typeof(o.receipt_snapshot->'masked_player_identifier') = 'string'
      AND NULLIF(btrim(o.receipt_snapshot->>'masked_player_identifier'), '') IS NOT NULL
      AND o.receipt_snapshot->>'masked_player_identifier' = CASE
        WHEN length(NULLIF(btrim(COALESCE(
          ord.player_inputs->>'user_id', ord.player_inputs->>'player_id',
          ord.player_inputs->>'uid', ord.player_inputs->>'riot_id'
        )), '')) <= 4
          THEN repeat('*', length(NULLIF(btrim(COALESCE(
            ord.player_inputs->>'user_id', ord.player_inputs->>'player_id',
            ord.player_inputs->>'uid', ord.player_inputs->>'riot_id'
          )), '')))
        ELSE repeat('*', length(NULLIF(btrim(COALESCE(
          ord.player_inputs->>'user_id', ord.player_inputs->>'player_id',
          ord.player_inputs->>'uid', ord.player_inputs->>'riot_id'
        )), '')) - 4)
          || right(NULLIF(btrim(COALESCE(
            ord.player_inputs->>'user_id', ord.player_inputs->>'player_id',
            ord.player_inputs->>'uid', ord.player_inputs->>'riot_id'
          )), ''), 4)
      END
      AND jsonb_typeof(o.receipt_snapshot->'completed_at') = 'string'
      AND o.receipt_snapshot->'completed_at' = to_jsonb(o.completed_at)
      AND lower(btrim(o.recipient_email)) = lower(btrim(ord.email))
      AND EXISTS (
        SELECT 1
        FROM public.supplier_transactions AS st
        WHERE st.order_id = ord.id
          AND st.status = 'success'
          AND st.action = 'create_order'
      )
      AND ord.status = 'COMPLETED'
      AND ord.payment_status = 'VERIFIED'
      AND ord.fulfillment_status = 'COMPLETED'
    ORDER BY o.next_attempt_at, o.created_at, o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.order_email_outbox AS o
    SET status = 'processing',
        attempt_count = o.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_until = clock_timestamp() + make_interval(secs => v_lease_seconds),
        last_error = NULL
    FROM candidates AS c
    WHERE o.id = c.id
    RETURNING o.id, o.order_id, o.recipient_email, o.receipt_snapshot,
              o.attempt_count, o.lease_token, o.lease_until
  )
  SELECT c.id, c.order_id, c.recipient_email, c.receipt_snapshot,
         c.attempt_count, c.lease_token, c.lease_until
  FROM claimed AS c;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ack_completion_receipt_sent(
  p_id uuid,
  p_lease_token uuid,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_provider_message_id text := NULLIF(left(btrim(COALESCE(p_provider_message_id, '')), 500), '');
BEGIN
  IF p_id IS NULL OR p_lease_token IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.order_email_outbox
  SET status = 'sent', lease_until = NULL, lease_token = NULL, sent_at = clock_timestamp(),
      provider_message_id = v_provider_message_id, last_error = NULL
  WHERE id = p_id AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_until IS NOT NULL AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_completion_receipt_outbox(
  p_id uuid,
  p_lease_token uuid,
  p_error text
)
RETURNS TABLE(out_status text, out_next_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_error_category text := CASE upper(btrim(COALESCE(p_error, '')))
    WHEN 'TIMEOUT' THEN 'delivery_timeout'
    WHEN 'RATE_LIMITED' THEN 'rate_limited'
    WHEN 'PROVIDER_UNAVAILABLE' THEN 'provider_unavailable'
    WHEN 'INVALID_RECIPIENT' THEN 'invalid_recipient'
    WHEN 'PROVIDER_REJECTED' THEN 'provider_rejected'
    WHEN 'UNKNOWN' THEN 'unclassified'
    ELSE 'unclassified'
  END;
  v_error text := left(regexp_replace(v_error_category, '[^a-z0-9_]', '', 'g'), 64);
  v_next timestamptz;
BEGIN
  IF p_id IS NULL OR p_lease_token IS NULL THEN
    RETURN QUERY SELECT 'rejected', NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.order_email_outbox
  SET status = CASE WHEN attempt_count >= 5 THEN 'dead_letter' ELSE 'pending' END,
      lease_until = NULL,
      lease_token = NULL,
      last_error = v_error,
      next_attempt_at = CASE
        WHEN attempt_count >= 5 THEN next_attempt_at
        ELSE clock_timestamp() + make_interval(secs => LEAST(900, 30 * (2 ^ LEAST(attempt_count - 1, 4))))
      END
  WHERE id = p_id AND status = 'processing'
    AND lease_token = p_lease_token
    AND lease_until IS NOT NULL AND lease_until > clock_timestamp();

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rejected', NULL::timestamptz;
    RETURN;
  END IF;

  SELECT o.next_attempt_at, o.status INTO v_next, out_status
  FROM public.order_email_outbox AS o WHERE o.id = p_id;
  RETURN QUERY SELECT out_status, v_next;
END;
$function$;

ALTER FUNCTION public.claim_completion_receipt_outbox(integer, integer) OWNER TO postgres;
ALTER FUNCTION public.ack_completion_receipt_sent(uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.fail_completion_receipt_outbox(uuid, uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.claim_completion_receipt_outbox(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ack_completion_receipt_sent(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_completion_receipt_outbox(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_completion_receipt_outbox(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ack_completion_receipt_sent(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_completion_receipt_outbox(uuid, uuid, text) TO service_role;

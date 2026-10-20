-- Phase 2 completion-receipt worker contract.
-- These service-role-only RPCs lease rows atomically; they never send mail.

ALTER TABLE public.order_email_outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
GRANT UPDATE (lease_token) ON TABLE public.order_email_outbox TO service_role;

CREATE OR REPLACE FUNCTION public.claim_completion_receipt_outbox(
  p_limit integer DEFAULT 10, p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE(out_id uuid, out_recipient_email text, out_receipt_snapshot jsonb,
  out_lease_token uuid, out_lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 3600);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id FROM public.order_email_outbox o
    WHERE (o.status = 'pending' AND o.next_attempt_at <= clock_timestamp())
       OR (o.status = 'processing' AND o.lease_until <= clock_timestamp())
    ORDER BY o.next_attempt_at, o.created_at, o.id FOR UPDATE SKIP LOCKED LIMIT v_limit
  ), leased AS (
    UPDATE public.order_email_outbox o
    SET status = 'processing', attempt_count = o.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_until = clock_timestamp() + make_interval(secs => v_lease_seconds),
        last_error = NULL
    FROM candidates c WHERE o.id = c.id
    RETURNING o.id, o.recipient_email, o.receipt_snapshot, o.lease_token, o.lease_until
  )
  SELECT l.id, l.recipient_email, l.receipt_snapshot, l.lease_token, l.lease_until FROM leased l;
END; $function$;

CREATE OR REPLACE FUNCTION public.ack_completion_receipt_sent(
  p_id uuid, p_lease_token uuid, p_provider_message_id text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  UPDATE public.order_email_outbox
  SET status = 'sent', provider_message_id = NULLIF(btrim(p_provider_message_id), ''),
      sent_at = clock_timestamp(), lease_until = NULL, lease_token = NULL, last_error = NULL
  WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp();
  RETURN FOUND;
END; $function$;

CREATE OR REPLACE FUNCTION public.fail_completion_receipt_outbox(
  p_id uuid, p_lease_token uuid, p_error text
)
RETURNS TABLE(out_status text, out_next_attempt_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
DECLARE v_status text; v_next timestamptz;
BEGIN
  IF NULLIF(btrim(COALESCE(p_error, '')), '') IS NULL THEN RETURN; END IF;
  UPDATE public.order_email_outbox
  SET status = CASE WHEN attempt_count >= 5 THEN 'dead_letter' ELSE 'pending' END,
      next_attempt_at = CASE WHEN attempt_count >= 5 THEN next_attempt_at
        ELSE clock_timestamp() + make_interval(secs => LEAST(3600, 60 * (2 ^ LEAST(attempt_count - 1, 5)))) END,
      lease_until = NULL, lease_token = NULL, last_error = left(btrim(p_error), 1000)
  WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token
    AND lease_until > clock_timestamp()
  RETURNING status, next_attempt_at INTO v_status, v_next;
  IF FOUND THEN RETURN QUERY SELECT v_status, v_next; END IF;
END; $function$;

REVOKE ALL ON FUNCTION public.claim_completion_receipt_outbox(integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ack_completion_receipt_sent(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_completion_receipt_outbox(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_completion_receipt_outbox(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ack_completion_receipt_sent(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_completion_receipt_outbox(uuid, uuid, text) TO service_role;

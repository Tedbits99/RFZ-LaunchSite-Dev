-- Durable, service-only reservation primitive for customer confirmation resend.
-- Keys are expected to be HMAC-derived lowercase SHA-256 hex strings. Raw
-- email addresses, network identifiers, tokens, and PKCE verifiers are never
-- accepted or stored here.

CREATE TABLE IF NOT EXISTS public.customer_confirmation_resend_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_key text NOT NULL CHECK (email_key ~ '^[0-9a-f]{64}$'),
  network_key text NOT NULL CHECK (network_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_confirmation_resend_email_idx
  ON public.customer_confirmation_resend_reservations (email_key, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_confirmation_resend_network_idx
  ON public.customer_confirmation_resend_reservations (network_key, created_at DESC);

ALTER TABLE public.customer_confirmation_resend_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_confirmation_resend_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_confirmation_resend_reservations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.customer_confirmation_resend_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_customer_confirmation_resend(
  p_email_key text,
  p_network_key text
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_email_lock bigint;
  v_network_lock bigint;
  v_email_recent bigint;
  v_email_day bigint;
  v_network_recent bigint;
  v_network_hour bigint;
  v_latest_email timestamptz;
  v_oldest_email_day timestamptz;
  v_oldest_network_recent timestamptz;
  v_oldest_network_hour timestamptz;
  v_retry_at timestamptz := v_now;
BEGIN
  IF p_email_key IS NULL
     OR p_network_key IS NULL
     OR p_email_key !~ '^[0-9a-f]{64}$'
     OR p_network_key !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  v_email_lock := pg_catalog.hashtextextended('email:' || p_email_key, 0);
  v_network_lock := pg_catalog.hashtextextended('network:' || p_network_key, 0);

  -- Lock both dimensions in deterministic order so overlapping requests do
  -- not deadlock while checking and reserving the same rolling windows.
  IF v_email_lock <= v_network_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(v_email_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_network_lock);
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(v_network_lock);
    PERFORM pg_catalog.pg_advisory_xact_lock(v_email_lock);
  END IF;

  -- Keep bounded retention without affecting any active window.
  DELETE FROM public.customer_confirmation_resend_reservations
  WHERE created_at < v_now - interval '24 hours';

  SELECT count(*), max(r.created_at), min(r.created_at)
  INTO v_email_day, v_latest_email, v_oldest_email_day
  FROM public.customer_confirmation_resend_reservations r
  WHERE r.email_key = p_email_key
    AND r.created_at > v_now - interval '24 hours';

  SELECT count(*) FILTER (WHERE r.created_at > v_now - interval '10 minutes'),
         count(*),
         min(r.created_at) FILTER (WHERE r.created_at > v_now - interval '10 minutes'),
         min(r.created_at)
  INTO v_network_recent, v_network_hour,
       v_oldest_network_recent, v_oldest_network_hour
  FROM public.customer_confirmation_resend_reservations r
  WHERE r.network_key = p_network_key
    AND r.created_at > v_now - interval '1 hour';

  IF v_latest_email IS NOT NULL
     AND v_latest_email > v_now - interval '60 seconds' THEN
    v_retry_at := greatest(v_retry_at, v_latest_email + interval '60 seconds');
  END IF;

  IF v_email_day >= 5 THEN
    v_retry_at := greatest(v_retry_at, v_oldest_email_day + interval '24 hours');
  END IF;

  IF v_network_recent >= 5 THEN
    v_retry_at := greatest(v_retry_at, v_oldest_network_recent + interval '10 minutes');
  END IF;

  IF v_network_hour >= 20 THEN
    v_retry_at := greatest(v_retry_at, v_oldest_network_hour + interval '1 hour');
  END IF;

  IF v_retry_at > v_now THEN
    RETURN QUERY
    SELECT false,
           greatest(1, ceil(extract(epoch FROM (v_retry_at - v_now)))::integer);
    RETURN;
  END IF;

  INSERT INTO public.customer_confirmation_resend_reservations (email_key, network_key)
  VALUES (p_email_key, p_network_key);

  RETURN QUERY SELECT true, 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_customer_confirmation_resend(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_customer_confirmation_resend(text, text)
  TO service_role;

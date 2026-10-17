\set ON_ERROR_STOP on

-- The harness invokes the same reservation from two independent psql
-- sessions. Exactly one reservation may be admitted for the shared keys.

BEGIN;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE email_key = repeat('8', 64)
    AND network_key = repeat('9', 64);

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_CONCURRENT_RESERVATION_COUNT_NOT_ONE';
  END IF;
END $$;

RESET ROLE;
COMMIT;

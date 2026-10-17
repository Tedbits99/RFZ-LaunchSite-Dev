\set ON_ERROR_STOP on

-- Disposable-only tests for the service-role confirmation-resend reservation
-- primitive. All identifiers are synthetic opaque hashes.

BEGIN;

-- Seed one expired row while connected as the migration owner. The function
-- itself is exercised only through the service_role grant below.
INSERT INTO public.customer_confirmation_resend_reservations
  (email_key, network_key, created_at)
VALUES (repeat('e', 64), repeat('f', 64), now() - interval '25 hours');

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_out record;
  v_count bigint;
  v_i integer;
BEGIN
  IF has_function_privilege(
       'service_role',
       'public.reserve_customer_confirmation_resend(text, text)',
       'EXECUTE'
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'RESEND_LIMITER_SERVICE_ROLE_EXECUTE_MISSING';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.reserve_customer_confirmation_resend(text, text)',
       'EXECUTE'
     ) IS TRUE
     OR has_function_privilege(
       'authenticated',
       'public.reserve_customer_confirmation_resend(text, text)',
       'EXECUTE'
     ) IS TRUE THEN
    RAISE EXCEPTION 'RESEND_LIMITER_UNAUTHORIZED_EXECUTE_GRANTED';
  END IF;

  IF has_table_privilege('anon', 'public.customer_confirmation_resend_reservations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.customer_confirmation_resend_reservations', 'SELECT')
     OR has_table_privilege('service_role', 'public.customer_confirmation_resend_reservations', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'RESEND_LIMITER_BACKING_TABLE_GRANTS_INVALID';
  END IF;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(repeat('a', 64), repeat('b', 64));
  IF v_out.allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RESEND_LIMITER_FIRST_RESERVATION_DENIED';
  END IF;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(repeat('a', 64), repeat('b', 64));
  IF v_out.allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RESEND_LIMITER_EMAIL_COOLDOWN_NOT_ENFORCED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE email_key = repeat('a', 64);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_DENIAL_CREATED_PARTIAL_RESERVATION';
  END IF;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend('not-a-key', repeat('c', 64));
  IF v_out.allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RESEND_LIMITER_INVALID_KEY_ACCEPTED';
  END IF;

  -- Five reservations in the rolling email window are allowed; the sixth is
  -- denied even after the cooldown has elapsed.
  FOR v_i IN 1..5 LOOP
    SELECT * INTO v_out
    FROM public.reserve_customer_confirmation_resend(
      repeat('d', 64),
      lpad(to_hex(v_i), 64, '0')
    );
    IF v_out.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RESEND_LIMITER_EMAIL_WINDOW_REJECTED_ALLOWED_RESERVATION';
    END IF;
    UPDATE public.customer_confirmation_resend_reservations
    SET created_at = now() - interval '61 seconds'
    WHERE email_key = repeat('d', 64);
  END LOOP;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(repeat('d', 64), repeat('e', 64));
  IF v_out.allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RESEND_LIMITER_EMAIL_DAILY_LIMIT_NOT_ENFORCED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE email_key = repeat('d', 64);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_EMAIL_DENIAL_CHANGED_RESERVATION_COUNT';
  END IF;

  -- Five reservations in ten minutes are allowed for a network key; the
  -- sixth is denied without creating a sixth row.
  FOR v_i IN 1..5 LOOP
    SELECT * INTO v_out
    FROM public.reserve_customer_confirmation_resend(
      lpad(to_hex(100 + v_i), 64, '0'), repeat('1', 64)
    );
    IF v_out.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RESEND_LIMITER_NETWORK_WINDOW_REJECTED_ALLOWED_RESERVATION';
    END IF;
  END LOOP;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(lpad(to_hex(106), 64, '0'), repeat('1', 64));
  IF v_out.allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RESEND_LIMITER_NETWORK_TEN_MINUTE_LIMIT_NOT_ENFORCED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE network_key = repeat('1', 64);
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_NETWORK_DENIAL_CHANGED_RESERVATION_COUNT';
  END IF;

  -- Move each prior event just outside the ten-minute window while retaining
  -- it in the one-hour window, allowing the rolling hourly limit to be tested.
  FOR v_i IN 1..20 LOOP
    UPDATE public.customer_confirmation_resend_reservations
    SET created_at = now() - interval '11 minutes'
    WHERE network_key = repeat('2', 64);

    SELECT * INTO v_out
    FROM public.reserve_customer_confirmation_resend(
      lpad(to_hex(1000 + v_i), 64, '0'), repeat('2', 64)
    );
    IF v_out.allowed IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RESEND_LIMITER_NETWORK_HOURLY_WINDOW_REJECTED_ALLOWED_RESERVATION';
    END IF;
  END LOOP;

  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(lpad(to_hex(1021), 64, '0'), repeat('2', 64));
  IF v_out.allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'RESEND_LIMITER_NETWORK_HOURLY_LIMIT_NOT_ENFORCED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE network_key = repeat('2', 64);
  IF v_count <> 20 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_HOURLY_DENIAL_CHANGED_RESERVATION_COUNT';
  END IF;

  -- The expired fixture row is cleaned during the next locked reservation.
  SELECT * INTO v_out
  FROM public.reserve_customer_confirmation_resend(repeat('6', 64), repeat('7', 64));
  IF v_out.allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RESEND_LIMITER_CLEANUP_RESERVATION_DENIED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.customer_confirmation_resend_reservations
  WHERE email_key = repeat('e', 64) AND network_key = repeat('f', 64);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RESEND_LIMITER_EXPIRED_RETENTION_NOT_CLEANED';
  END IF;

END $$;

RESET ROLE;

COMMIT;

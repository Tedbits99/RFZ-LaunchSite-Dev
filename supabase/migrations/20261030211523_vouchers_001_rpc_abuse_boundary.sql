-- Remove the browser-accessible voucher oracle. The server route verifies the
-- customer session, enforces the trusted edge-IP budget, then supplies the
-- verified Auth UUID to the service-role-only RPC below. No browser-supplied
-- email or UUID is treated as an authenticated identity.
REVOKE ALL ON FUNCTION public.validate_campaign_voucher(text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_campaign_voucher(text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.validate_campaign_voucher_for_server(
  p_code text,
  p_package_id uuid,
  p_email text,
  p_customer_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  out_valid boolean,
  out_error text,
  out_discount_cents integer,
  out_total_cents integer,
  out_starts_at timestamptz,
  out_ends_at timestamptz,
  out_timezone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_claims jsonb;
BEGIN
  -- auth.uid() in the campaign evaluator must reflect only the UUID resolved
  -- by auth.getUser() in the trusted Next.js route. This RPC is service-role
  -- only; the supplied UUID is never accepted from the browser request body.
  IF p_customer_user_id IS NULL THEN
    v_claims := jsonb_build_object('role', 'anon');
  ELSE
    v_claims := jsonb_build_object('sub', p_customer_user_id, 'role', 'authenticated');
  END IF;
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_customer_user_id::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_customer_user_id IS NULL THEN 'anon' ELSE 'authenticated' END, true);

  RETURN QUERY
  SELECT e.out_valid, e.out_error, e.out_discount_cents, e.out_total_cents,
         e.out_starts_at, e.out_ends_at, e.out_timezone
  FROM public.evaluate_promotion_voucher(p_code, p_package_id, p_email, false) e;

  PERFORM set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  RAISE;
END;
$function$;
REVOKE ALL ON FUNCTION public.validate_campaign_voucher_for_server(text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_campaign_voucher_for_server(text, uuid, text, uuid)
  TO service_role;

-- The order RPCs intentionally remain callable by anonymous guests and
-- authenticated customers. Unlike the validation route, they cannot rely on
-- a Next.js IP limiter because PostgREST is directly reachable. Enforce a
-- bounded budget in the database before any voucher lookup: 10 per rolling
-- 60 seconds per verified user, 10 per normalized guest email, plus a 60-per-
-- rolling-60-second aggregate guest ceiling that resists email rotation.
-- Keys are salted hashes in the existing bounded/private bucket table.
CREATE OR REPLACE FUNCTION voucher_private.consume_checkout_rate_bucket(
  p_identity text,
  p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_salt text;
  v_hash text;
  v_window timestamptz := statement_timestamp();
  v_attempts integer;
  v_existing_window timestamptz;
  v_total integer;
BEGIN
  IF p_identity IS NULL OR length(p_identity) > 400 OR p_limit < 1 OR p_limit > 1000 THEN
    RETURN false;
  END IF;
  SELECT s.salt::text INTO v_salt FROM voucher_private.rate_limit_salt s WHERE s.singleton;
  IF v_salt IS NULL THEN RETURN false; END IF;
  v_hash := md5(v_salt || '|checkout|' || p_identity);

  -- Serialize per identity, including first-use races, and cap attempts at
  -- limit+1 so repeated blocked calls cannot overflow the integer counter.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hash, 928417));
  SELECT b.attempts, b.window_started_at INTO v_attempts, v_existing_window
  FROM voucher_private.rate_limit_buckets b WHERE b.ip_hash = v_hash FOR UPDATE;
  IF FOUND THEN
    IF v_existing_window <= v_window - interval '1 minute' THEN
      UPDATE voucher_private.rate_limit_buckets
      SET window_started_at = v_window, attempts = 1, updated_at = statement_timestamp()
      WHERE ip_hash = v_hash;
      RETURN true;
    END IF;
    UPDATE voucher_private.rate_limit_buckets
    SET attempts = least(attempts + 1, p_limit + 1), updated_at = statement_timestamp()
    WHERE ip_hash = v_hash
    RETURNING attempts INTO v_attempts;
    RETURN v_attempts <= p_limit;
  END IF;

  PERFORM pg_advisory_xact_lock(7643921, 1);
  DELETE FROM voucher_private.rate_limit_buckets b
  WHERE b.ctid IN (
    SELECT stale.ctid FROM voucher_private.rate_limit_buckets stale
    WHERE stale.window_started_at < v_window - interval '1 day'
    ORDER BY stale.window_started_at LIMIT 500
  );
  SELECT count(*)::integer INTO v_total FROM voucher_private.rate_limit_buckets;
  IF v_total >= 100000 THEN RETURN false; END IF;
  INSERT INTO voucher_private.rate_limit_buckets(ip_hash, window_started_at, attempts)
  VALUES (v_hash, v_window, 1);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION voucher_private.consume_checkout_rate_bucket(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION voucher_private.consume_checkout_voucher_attempt(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email_hash text := md5(lower(btrim(left(coalesce(p_email, ''), 320))));
BEGIN
  IF v_user_id IS NOT NULL THEN
    RETURN voucher_private.consume_checkout_rate_bucket('customer:' || v_user_id::text, 10);
  END IF;
  IF NOT voucher_private.consume_checkout_rate_bucket('guest:all', 60) THEN
    RETURN false;
  END IF;
  RETURN voucher_private.consume_checkout_rate_bucket('guest:email:' || v_email_hash, 10);
END;
$function$;
REVOKE ALL ON FUNCTION voucher_private.consume_checkout_voucher_attempt(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_order(
  p_game_id uuid,
  p_package_id uuid,
  p_email text,
  p_customer_name text,
  p_player_inputs jsonb,
  p_payment_method text,
  p_voucher_code text DEFAULT NULL,
  p_voucher_email text DEFAULT NULL
)
RETURNS TABLE(out_reference text, out_order_id uuid, out_total_cents integer, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, voucher_private
AS $function$
DECLARE
  v_pkg public.packages%ROWTYPE;
  v_fields record;
  v_input_value text;
  v_subtotal integer;
  v_discount integer := 0;
  v_total integer;
  v_voucher public.vouchers%ROWTYPE;
  v_voucher_id uuid;
  v_campaign_id uuid;
  v_eval record;
  v_reference text;
  v_order_id uuid;
  v_pay public.payment_config%ROWTYPE;
  v_snapshot jsonb;
  v_mapping_id uuid;
  v_code text := upper(btrim(coalesce(p_voucher_code, '')));
BEGIN
  SELECT p.* INTO v_pkg FROM public.packages p WHERE p.id = p_package_id AND p.is_active = true;
  IF NOT FOUND OR v_pkg.game_id IS DISTINCT FROM p_game_id THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected package is no longer available.'::text;
    RETURN;
  END IF;

  FOR v_fields IN
    SELECT f.field_key, f.label, f.is_required
    FROM public.game_input_fields f WHERE f.game_id = p_game_id ORDER BY f.sort_order
  LOOP
    IF v_fields.is_required THEN
      v_input_value := coalesce(p_player_inputs ->> v_fields.field_key, '');
      IF btrim(v_input_value) = '' THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Please enter your ' || v_fields.label || '.')::text;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  SELECT p.* INTO v_pay FROM public.payment_config p
  WHERE p.method_key = p_payment_method AND p.is_enabled IS TRUE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected payment method is no longer available. Please choose another.'::text;
    RETURN;
  END IF;
  IF v_pay.min_amount_cents IS NOT NULL AND v_pkg.price_cents < v_pay.min_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Minimum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.min_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;
  IF v_pay.max_amount_cents IS NOT NULL AND v_pay.max_amount_cents > 0 AND v_pkg.price_cents > v_pay.max_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Maximum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.max_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;

  v_subtotal := v_pkg.price_cents;
  v_total := v_subtotal;
  IF v_code <> '' THEN
    IF NOT voucher_private.consume_checkout_voucher_attempt(p_email) THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Promotion validation is temporarily unavailable.'::text;
      RETURN;
    END IF;
    IF length(v_code) > 50 THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid or unavailable promotion code.'::text;
      RETURN;
    END IF;
    SELECT v.* INTO v_voucher FROM public.vouchers v
    WHERE upper(btrim(v.code)) = v_code FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid or unavailable promotion code.'::text;
      RETURN;
    END IF;
    SELECT c.id INTO v_campaign_id FROM public.promotion_campaigns c
    WHERE c.voucher_id = v_voucher.id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This promotion requires administrator review.'::text;
      RETURN;
    END IF;
    SELECT * INTO v_eval FROM public.evaluate_promotion_voucher(
      v_voucher.code, p_package_id, coalesce(p_voucher_email, p_email), false
    );
    IF NOT coalesce(v_eval.out_valid, false) THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, v_eval.out_error;
      RETURN;
    END IF;
    v_discount := v_eval.out_discount_cents;
    v_total := v_eval.out_total_cents;
  END IF;
  IF v_total <= 0 THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The final order total must be greater than zero.'::text;
    RETURN;
  END IF;
  IF v_pay.min_amount_cents IS NOT NULL AND v_total < v_pay.min_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer,
      ('Discounted total is below the minimum amount for ' || v_pay.display_name || '.')::text;
    RETURN;
  END IF;

  v_reference := public.generate_order_reference();
  v_snapshot := jsonb_build_object(
    'method_key', v_pay.method_key,
    'display_name', v_pay.display_name,
    'account_name', v_pay.account_name,
    'account_number', v_pay.account_number,
    'instructions', v_pay.instructions,
    'qr_data', v_pay.qr_data,
    'provider_type', v_pay.provider_type,
    'provider_name', v_pay.provider_name
  );
  SELECT m.id INTO v_mapping_id
  FROM public.supplier_package_mappings m
  JOIN public.suppliers s ON s.id = m.supplier_id
  WHERE m.package_id = p_package_id AND m.enabled IS TRUE AND s.enabled IS TRUE
  ORDER BY m.priority DESC LIMIT 1;

  INSERT INTO public.orders (
    reference, email, customer_name, game_id, package_id, player_inputs,
    subtotal_cents, discount_cents, total_cents, payment_method, status,
    voucher_id, voucher_code, voucher_discount_type, voucher_discount_value,
    voucher_discount_cents, payment_mode, payment_provider,
    payment_config_snapshot, supplier_mapping_id
  ) VALUES (
    v_reference, lower(btrim(p_email)), coalesce(p_customer_name, 'Guest'),
    p_game_id, p_package_id, coalesce(p_player_inputs, '{}'::jsonb),
    v_subtotal, v_discount, v_total, p_payment_method, 'WAITING_PAYMENT',
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.id END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.code END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.discount_type END,
    CASE WHEN v_code = '' THEN NULL ELSE v_voucher.discount_value END,
    v_discount, v_pay.provider_type, v_pay.provider_name, v_snapshot, v_mapping_id
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_timeline(order_id, status, actor_email, note)
  VALUES (v_order_id, 'WAITING_PAYMENT', lower(btrim(p_email)), 'Order created');
  IF v_code <> '' THEN
    INSERT INTO public.voucher_usages(voucher_id, order_id, email)
    VALUES (v_voucher.id, v_order_id, coalesce(p_voucher_email, lower(btrim(p_email))))
    ON CONFLICT (voucher_id, order_id) DO NOTHING;
  END IF;
  RETURN QUERY SELECT v_reference, v_order_id, v_total, NULL::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text)
  TO anon, authenticated;

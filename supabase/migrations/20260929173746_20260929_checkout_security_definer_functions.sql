-- ============================================================================
-- Fix checkout/order system: add missing voucher columns + SECURITY DEFINER
-- functions so the app works with the anon key (no service role key needed).
-- ============================================================================

-- 1. Add missing voucher columns to orders (the API route writes to these).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_discount_type text,
  ADD COLUMN IF NOT EXISTS voucher_discount_value numeric,
  ADD COLUMN IF NOT EXISTS voucher_discount_cents integer DEFAULT 0;

-- 2. create_order: atomic order creation callable by anon.
--    Validates package, computes price, validates+consumes voucher, generates
--    reference, inserts order + timeline — all in one transaction as postgres.
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
SET search_path = public
AS $function$
DECLARE
  v_pkg RECORD;
  v_fields RECORD;
  v_input_value text;
  v_subtotal integer;
  v_discount integer := 0;
  v_total integer;
  v_voucher RECORD;
  v_reference text;
  v_order_id uuid;
  v_usage_count integer;
  v_user_count integer;
BEGIN
  -- Validate package
  SELECT * INTO v_pkg FROM public.packages WHERE id = p_package_id AND is_active = true;
  IF NOT FOUND OR v_pkg.game_id != p_game_id THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected package is no longer available.'::text;
    RETURN;
  END IF;

  -- Validate required player input fields
  FOR v_fields IN SELECT field_key, label, is_required FROM public.game_input_fields WHERE game_id = p_game_id ORDER BY sort_order LOOP
    IF v_fields.is_required THEN
      v_input_value := COALESCE((p_player_inputs ->> v_fields.field_key), '');
      IF btrim(v_input_value) = '' THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Please enter your ' || v_fields.label || '.')::text;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  v_subtotal := v_pkg.price_cents;
  v_total := v_subtotal;

  -- Validate voucher if provided
  IF p_voucher_code IS NOT NULL AND btrim(p_voucher_code) != '' THEN
    SELECT * INTO v_voucher FROM public.vouchers
      WHERE upper(code) = upper(btrim(p_voucher_code)) AND is_active = true;

    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'Invalid voucher code.'::text;
      RETURN;
    END IF;

    IF v_voucher.starts_at > now() THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This voucher is not yet active.'::text;
      RETURN;
    END IF;

    IF v_voucher.ends_at IS NOT NULL AND v_voucher.ends_at < now() THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This voucher has expired.'::text;
      RETURN;
    END IF;

    IF v_voucher.usage_limit IS NOT NULL THEN
      SELECT count(*) INTO v_usage_count FROM public.voucher_usages WHERE voucher_id = v_voucher.id;
      IF v_usage_count >= v_voucher.usage_limit THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This voucher has reached its usage limit.'::text;
        RETURN;
      END IF;
    END IF;

    IF p_voucher_email IS NOT NULL AND v_voucher.per_user_limit > 0 THEN
      SELECT count(*) INTO v_user_count FROM public.voucher_usages WHERE voucher_id = v_voucher.id AND email = p_voucher_email;
      IF v_user_count >= v_voucher.per_user_limit THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'You have already used this voucher.'::text;
        RETURN;
      END IF;
    END IF;

    IF v_voucher.applies_to_game_id IS NOT NULL AND v_voucher.applies_to_game_id != p_game_id THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This voucher is not available for this product.'::text;
      RETURN;
    END IF;

    IF v_voucher.min_order_cents > 0 AND v_subtotal < v_voucher.min_order_cents THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Minimum purchase of ₱' || (v_voucher.min_order_cents / 100.0)::text || ' required.')::text;
      RETURN;
    END IF;

    -- Compute discount
    IF v_voucher.discount_type = 'PERCENTAGE' THEN
      v_discount := round((v_subtotal * v_voucher.discount_value) / 100);
      IF v_voucher.max_discount_cents IS NOT NULL AND v_voucher.max_discount_cents >= 0 THEN
        v_discount := least(v_discount, v_voucher.max_discount_cents);
      END IF;
    ELSE
      v_discount := v_voucher.discount_value;
    END IF;
    v_discount := greatest(0, least(v_discount, v_subtotal));
    v_total := v_subtotal - v_discount;
  END IF;

  -- Generate unique reference
  v_reference := public.generate_order_reference();

  -- Insert order
  INSERT INTO public.orders (
    reference, email, customer_name, game_id, package_id, player_inputs,
    subtotal_cents, discount_cents, total_cents, payment_method, status,
    voucher_id, voucher_code, voucher_discount_type, voucher_discount_value, voucher_discount_cents
  ) VALUES (
    v_reference, lower(btrim(p_email)), COALESCE(p_customer_name, 'Guest'),
    p_game_id, p_package_id, COALESCE(p_player_inputs, '{}'::jsonb),
    v_subtotal, v_discount, v_total, p_payment_method, 'WAITING_PAYMENT',
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.id ELSE NULL END,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.code ELSE NULL END,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.discount_type ELSE NULL END,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.discount_value ELSE NULL END,
    v_discount
  ) RETURNING id INTO v_order_id;

  -- Timeline entry
  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (v_order_id, 'WAITING_PAYMENT', lower(btrim(p_email)), 'Order created');

  -- Consume voucher (idempotent via unique constraint)
  IF v_voucher.id IS NOT NULL THEN
    INSERT INTO public.voucher_usages (voucher_id, order_id, email)
    VALUES (v_voucher.id, v_order_id, COALESCE(p_voucher_email, lower(btrim(p_email))))
    ON CONFLICT (voucher_id, order_id) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_reference, v_order_id, v_total, NULL::text;
END;
$function$;

-- 3. submit_payment: customer submits payment proof (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.submit_payment(
  p_order_reference text,
  p_email text,
  p_payment_method text DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS TABLE(out_success boolean, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, email, status, total_cents, payment_method INTO v_order
  FROM public.orders
  WHERE reference = upper(btrim(p_order_reference))
    AND lower(email) = lower(btrim(p_email));

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Order not found. Check your reference and email.'::text;
    RETURN;
  END IF;

  IF v_order.status != 'WAITING_PAYMENT' THEN
    RETURN QUERY SELECT false, 'Payment has already been submitted or the order is no longer awaiting payment.'::text;
    RETURN;
  END IF;

  -- Record submission
  INSERT INTO public.payment_submissions (
    order_id, payment_method, reference_number, amount_cents, note
  ) VALUES (
    v_order.id,
    COALESCE(p_payment_method, v_order.payment_method),
    left(btrim(COALESCE(p_reference_number, '')), 200),
    v_order.total_cents,
    left(btrim(COALESCE(p_note, '')), 1000)
  );

  -- Mark order
  UPDATE public.orders
  SET payment_reference = left(btrim(COALESCE(p_reference_number, '')), 200),
      payment_submitted_at = now(),
      updated_at = now()
  WHERE id = v_order.id;

  -- Timeline
  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (v_order.id, 'WAITING_PAYMENT', v_order.email, 'Payment information submitted by customer');

  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

-- 4. Grant execute to anon and authenticated.
GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_payment(text, text, text, text, text) TO anon, authenticated;

-- 5. Grant SELECT on order_timeline to anon (already exists, but ensure).
-- Already has anon_select_order_timeline policy.

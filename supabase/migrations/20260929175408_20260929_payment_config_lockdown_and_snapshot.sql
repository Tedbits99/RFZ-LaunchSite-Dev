-- ============================================================================
-- Payment config: lock down RLS + add missing columns + payment snapshot
-- ============================================================================

-- 1. Lock down payment_config: anon can only SELECT enabled rows.
--    All mutations go through admin API routes (requireAdmin + service key).
DROP POLICY IF EXISTS "service_all_payment_config" ON public.payment_config;
DROP POLICY IF EXISTS "anon_delete_payment_config" ON public.payment_config;
DROP POLICY IF EXISTS "anon_insert_payment_config" ON public.payment_config;
DROP POLICY IF EXISTS "anon_update_payment_config" ON public.payment_config;
DROP POLICY IF EXISTS "public_read_payment_config" ON public.payment_config;

-- Customer-facing: only see enabled methods (checkout page).
CREATE POLICY "public_read_enabled_payment_config_v2"
  ON public.payment_config FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

-- 2. Add missing columns to payment_config.
ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS min_amount_cents integer,
  ADD COLUMN IF NOT EXISTS max_amount_cents integer,
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0;

-- 3. Add payment config snapshot to orders so historical order instructions
--    don't change when admin edits the payment config later.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_config_snapshot jsonb;

-- 4. Add payment_config_snapshot to the create_order function.
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
  v_voucher_id uuid := NULL;
  v_voucher_code text := NULL;
  v_voucher_discount_type text := NULL;
  v_voucher_discount_value numeric := NULL;
  v_voucher RECORD;
  v_reference text;
  v_order_id uuid;
  v_usage_count integer;
  v_user_count integer;
  v_pay RECORD;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_pkg FROM public.packages WHERE id = p_package_id AND is_active = true;
  IF NOT FOUND OR v_pkg.game_id != p_game_id THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected package is no longer available.'::text;
    RETURN;
  END IF;

  FOR v_fields IN SELECT field_key, label, is_required FROM public.game_input_fields WHERE game_id = p_game_id ORDER BY sort_order LOOP
    IF v_fields.is_required THEN
      v_input_value := COALESCE((p_player_inputs ->> v_fields.field_key), '');
      IF btrim(v_input_value) = '' THEN
        RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Please enter your ' || v_fields.label || '.')::text;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  -- Validate payment method is enabled
  SELECT * INTO v_pay FROM public.payment_config
    WHERE method_key = p_payment_method AND is_enabled = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'The selected payment method is no longer available. Please choose another.'::text;
    RETURN;
  END IF;

  -- Check min/max amount constraints
  IF v_pay.min_amount_cents IS NOT NULL AND v_pkg.price_cents < v_pay.min_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Minimum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.min_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;
  IF v_pay.max_amount_cents IS NOT NULL AND v_pay.max_amount_cents > 0 AND v_pkg.price_cents > v_pay.max_amount_cents THEN
    RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Maximum amount for ' || v_pay.display_name || ' is ₱' || (v_pay.max_amount_cents / 100.0)::text || '.')::text;
    RETURN;
  END IF;

  v_subtotal := v_pkg.price_cents;
  v_total := v_subtotal;

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
    IF v_voucher.min_order_cents > 0 AND v_subtotal < v_voucher.min_order_cents THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, ('Minimum purchase required.')::text;
      RETURN;
    END IF;

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

    v_voucher_id := v_voucher.id;
    v_voucher_code := v_voucher.code;
    v_voucher_discount_type := v_voucher.discount_type;
    v_voucher_discount_value := v_voucher.discount_value;
  END IF;

  v_reference := public.generate_order_reference();

  -- Snapshot the payment config at order creation time
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

  INSERT INTO public.orders (
    reference, email, customer_name, game_id, package_id, player_inputs,
    subtotal_cents, discount_cents, total_cents, payment_method, status,
    voucher_id, voucher_code, voucher_discount_type, voucher_discount_value, voucher_discount_cents,
    payment_mode, payment_provider, payment_config_snapshot
  ) VALUES (
    v_reference, lower(btrim(p_email)), COALESCE(p_customer_name, 'Guest'),
    p_game_id, p_package_id, COALESCE(p_player_inputs, '{}'::jsonb),
    v_subtotal, v_discount, v_total, p_payment_method, 'WAITING_PAYMENT',
    v_voucher_id, v_voucher_code, v_voucher_discount_type, v_voucher_discount_value, v_discount,
    v_pay.provider_type, v_pay.provider_name, v_snapshot
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_timeline (order_id, status, actor_email, note)
  VALUES (v_order_id, 'WAITING_PAYMENT', lower(btrim(p_email)), 'Order created');

  IF v_voucher_id IS NOT NULL THEN
    INSERT INTO public.voucher_usages (voucher_id, order_id, email)
    VALUES (v_voucher_id, v_order_id, COALESCE(p_voucher_email, lower(btrim(p_email))))
    ON CONFLICT (voucher_id, order_id) DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_reference, v_order_id, v_total, NULL::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_order(uuid, uuid, text, text, jsonb, text, text, text) TO anon, authenticated;

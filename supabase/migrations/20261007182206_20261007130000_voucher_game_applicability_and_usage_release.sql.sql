/*
# Voucher game applicability + usage-release trigger

1. Plain-English explanation
   Two related voucher improvements:
   a) Admins can restrict a voucher to a single game (e.g. only Mobile
      Legends orders). Orders for other games are rejected at checkout,
      both in the pre-check API and inside the atomic create_order
      function that is the single source of truth.
   b) A trigger on orders releases the voucher usage slot when an order
      ends in FAILED, CANCELLED, or EXPIRED, so failed orders do not
      consume a customer's voucher usage.

2. Modified tables
   - `vouchers`: new nullable column `applies_to_game_id` (uuid, references
     games.id, ON DELETE SET NULL). NULL means the voucher works on all games.
   - `orders`: no schema change; new trigger `trg_orders_voucher_release`.

3. Modified functions
   - `create_order`: re-added the game-applicability check so the
      authoritative server-side order creation validates it.

4. Security changes
   - None. RLS on vouchers is unchanged (admin-only writes, no public
     reads). The trigger function is SECURITY DEFINER with a locked
     search_path and cannot be called directly.

5. Important notes
   - The check in create_order matches the checkout pre-check API so the
     two can never disagree.
*/

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS applies_to_game_id uuid
  REFERENCES public.games(id) ON DELETE SET NULL;

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
    IF v_voucher.applies_to_game_id IS NOT NULL AND v_voucher.applies_to_game_id != p_game_id THEN
      RETURN QUERY SELECT NULL::text, NULL::uuid, NULL::integer, 'This voucher is not available for this product.'::text;
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

  INSERT INTO public.orders (
    reference, email, customer_name, game_id, package_id, player_inputs,
    subtotal_cents, discount_cents, total_cents, payment_method, status,
    voucher_id, voucher_code, voucher_discount_type, voucher_discount_value, voucher_discount_cents
  ) VALUES (
    v_reference, lower(btrim(p_email)), COALESCE(p_customer_name, 'Guest'),
    p_game_id, p_package_id, COALESCE(p_player_inputs, '{}'::jsonb),
    v_subtotal, v_discount, v_total, p_payment_method, 'WAITING_PAYMENT',
    v_voucher_id, v_voucher_code, v_voucher_discount_type, v_voucher_discount_value, v_discount
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

CREATE OR REPLACE FUNCTION public.release_voucher_usage_on_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.voucher_id IS NOT NULL
     AND NEW.status IN ('FAILED', 'CANCELLED', 'EXPIRED')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN
    DELETE FROM public.voucher_usages
    WHERE voucher_id = NEW.voucher_id AND order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_voucher_release ON public.orders;

CREATE TRIGGER trg_orders_voucher_release
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.release_voucher_usage_on_failure();

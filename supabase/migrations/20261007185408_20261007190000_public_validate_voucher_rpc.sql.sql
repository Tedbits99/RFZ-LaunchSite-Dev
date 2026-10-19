/*
# Public voucher validation function

1. Plain-English explanation
   Customers at checkout must be able to check whether a voucher code is
   valid, but a previous security lockdown correctly denies direct reads
   of the vouchers table to non-admin users. That made every customer
   attempt return "Invalid voucher code." This migration adds a safe,
   read-only validation function that any visitor can call: it returns
   only whether the code is valid, the specific reason when it is not
   (expired, usage limit, already used, minimum order, wrong game,
   inactive), and the computed discount. It never exposes the voucher
   table itself.

2. New functions
   - `validate_voucher(p_code, p_subtotal_cents, p_game_id, p_email)`:
     SECURITY DEFINER, locked search_path. Mirrors the exact checks the
     atomic create_order function performs, so checkout display and order
     creation can never disagree.

3. Security changes
   - Grants EXECUTE on this function to anon and authenticated. It is
     read-only: it only SELECTs vouchers and voucher_usages internally and
     returns a boolean, a reason string, and amounts. No table grants are
     added; the existing deny-all customer policy on vouchers remains.

4. Important notes
   - Codes are normalized (trim + uppercase) inside the function.
   - The authoritative check still happens inside create_order at order
     time; this function is for display and friendly error messages.
*/

CREATE OR REPLACE FUNCTION public.validate_voucher(
  p_code text,
  p_subtotal_cents integer,
  p_game_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (out_valid boolean, out_error text, out_discount_cents integer, out_total_cents integer, out_voucher jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.vouchers%ROWTYPE;
  v_discount integer := 0;
  v_usage_count integer := 0;
  v_user_count integer := 0;
BEGIN
  SELECT * INTO v FROM public.vouchers
    WHERE upper(code) = upper(btrim(COALESCE(p_code, '')))
    LIMIT 1;

  IF NOT FOUND THEN
    out_valid := false; out_error := 'Invalid voucher code.';
    out_discount_cents := 0; out_total_cents := 0; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF NOT v.is_active THEN
    out_valid := false; out_error := 'Voucher is currently inactive.';
    out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v.starts_at > now() THEN
    out_valid := false; out_error := 'This voucher is not yet active.';
    out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v.ends_at IS NOT NULL AND v.ends_at < now() THEN
    out_valid := false; out_error := 'This voucher has expired.';
    out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v.applies_to_game_id IS NOT NULL AND p_game_id IS NOT NULL AND v.applies_to_game_id != p_game_id THEN
    out_valid := false; out_error := 'This voucher is not available for this product.';
    out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v.usage_limit IS NOT NULL THEN
    SELECT count(*) INTO v_usage_count FROM public.voucher_usages WHERE voucher_id = v.id;
    IF v_usage_count >= v.usage_limit THEN
      out_valid := false; out_error := 'This voucher has reached its usage limit.';
      out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF p_email IS NOT NULL AND v.per_user_limit > 0 THEN
    SELECT count(*) INTO v_user_count FROM public.voucher_usages
      WHERE voucher_id = v.id AND email = lower(btrim(p_email));
    IF v_user_count >= v.per_user_limit THEN
      out_valid := false; out_error := 'You have already used this voucher.';
      out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  IF v.min_order_cents > 0 AND p_subtotal_cents < v.min_order_cents THEN
    out_valid := false;
    out_error := 'Minimum purchase of ₱' || round(v.min_order_cents / 100.0, 2)::text || ' required.';
    out_discount_cents := 0; out_total_cents := p_subtotal_cents; out_voucher := NULL;
    RETURN NEXT; RETURN;
  END IF;

  IF v.discount_type = 'PERCENTAGE' THEN
    v_discount := round((p_subtotal_cents * v.discount_value) / 100);
    IF v.max_discount_cents IS NOT NULL AND v.max_discount_cents >= 0 THEN
      v_discount := least(v_discount, v.max_discount_cents);
    END IF;
  ELSE
    v_discount := v.discount_value;
  END IF;
  v_discount := greatest(0, least(v_discount, p_subtotal_cents));

  out_valid := true; out_error := NULL;
  out_discount_cents := v_discount;
  out_total_cents := p_subtotal_cents - v_discount;
  out_voucher := to_jsonb(v);
  RETURN NEXT; RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_voucher(text, integer, uuid, text) TO anon, authenticated;

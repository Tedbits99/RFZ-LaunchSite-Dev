-- SECURITY DEFINER functions for admin payment config mutations.
-- RLS blocks anon from mutating payment_config; these functions run as
-- postgres so admin API routes (which check requireAdmin) can still
-- create/update/delete configs with just the anon key.

CREATE OR REPLACE FUNCTION public.admin_upsert_payment_config(
  p_id uuid DEFAULT NULL,
  p_method_key text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_provider text DEFAULT 'manual',
  p_provider_type text DEFAULT 'manual',
  p_provider_name text DEFAULT 'manual',
  p_is_enabled boolean DEFAULT true,
  p_account_name text DEFAULT '',
  p_account_number text DEFAULT '',
  p_qr_data text DEFAULT NULL,
  p_instructions text DEFAULT '',
  p_api_url text DEFAULT '',
  p_is_test_mode boolean DEFAULT false,
  p_currency text DEFAULT 'PHP',
  p_supported_methods text[] DEFAULT '{}',
  p_sort_order integer DEFAULT 0,
  p_min_amount_cents integer DEFAULT NULL,
  p_max_amount_cents integer DEFAULT NULL,
  p_notes text DEFAULT '',
  p_webhook_url text DEFAULT NULL
)
RETURNS TABLE(out_id uuid, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_method_key text;
  v_display_name text;
BEGIN
  v_method_key := lower(COALESCE(p_method_key, ''));
  v_display_name := COALESCE(p_display_name, '');

  IF v_method_key = '' OR v_display_name = '' THEN
    RETURN QUERY SELECT NULL::uuid, 'method_key and display_name are required.'::text;
    RETURN;
  END IF;

  IF p_id IS NOT NULL THEN
    -- UPDATE
    UPDATE public.payment_config SET
      method_key = v_method_key,
      display_name = v_display_name,
      provider = p_provider,
      provider_type = p_provider_type,
      provider_name = p_provider_name,
      is_enabled = p_is_enabled,
      account_name = p_account_name,
      account_number = p_account_number,
      qr_data = left(COALESCE(p_qr_data, ''), 2000),
      instructions = p_instructions,
      api_url = p_api_url,
      is_test_mode = p_is_test_mode,
      currency = p_currency,
      supported_methods = p_supported_methods,
      sort_order = p_sort_order,
      min_amount_cents = p_min_amount_cents,
      max_amount_cents = p_max_amount_cents,
      notes = p_notes,
      webhook_url = p_webhook_url,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, 'Payment method not found.'::text;
      RETURN;
    END IF;
  ELSE
    -- INSERT
    INSERT INTO public.payment_config (
      method_key, display_name, provider, provider_type, provider_name,
      is_enabled, account_name, account_number, qr_data, instructions,
      api_url, is_test_mode, currency, supported_methods, sort_order,
      min_amount_cents, max_amount_cents, notes, webhook_url
    ) VALUES (
      v_method_key, v_display_name, p_provider, p_provider_type, p_provider_name,
      p_is_enabled, p_account_name, p_account_number,
      left(COALESCE(p_qr_data, ''), 2000), p_instructions,
      p_api_url, p_is_test_mode, p_currency, p_supported_methods, p_sort_order,
      p_min_amount_cents, p_max_amount_cents, p_notes, p_webhook_url
    ) RETURNING id INTO v_id;
  END IF;

  RETURN QUERY SELECT v_id, NULL::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_payment_config(p_id uuid)
RETURNS TABLE(out_success boolean, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM public.payment_config WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Payment method not found.'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

-- Only authenticated users can call these (admin API routes check requireAdmin).
REVOKE EXECUTE ON FUNCTION public.admin_upsert_payment_config FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_payment_config TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) TO authenticated;

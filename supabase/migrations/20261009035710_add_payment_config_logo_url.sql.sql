/*
# Add logo_url column to payment_config

## Purpose
Allows admins to set a logo image URL per payment method. The logo is displayed
on user-facing checkout pages next to the payment method name, with a graceful
fallback when the URL is empty or the image fails to load.

## Changes
1. New column on `public.payment_config`:
   - `logo_url` (text, nullable, default NULL) — optional URL to a payment
     method logo image. NULL or empty means "no logo"; the UI falls back to the
     existing gradient icon background.
2. Updated `admin_upsert_payment_config` SECURITY DEFINER function:
   - Added `p_logo_url text DEFAULT NULL` parameter.
   - INSERT and UPDATE branches now set `logo_url = p_logo_url`.
   - Existing behavior for all other fields is unchanged.

## Security
- No RLS policy changes. The column is non-sensitive display metadata.
- `admin_get_all_payment_config` (SETOF payment_config) automatically returns
  the new column with no function change needed.
- Public SELECT policy (anon) still applies; logo_url is safe to expose.

## Notes
- Idempotent: uses IF NOT EXISTS for the column addition.
- The RPC is recreated with CREATE OR REPLACE, so re-running is safe.
*/

ALTER TABLE public.payment_config
  ADD COLUMN IF NOT EXISTS logo_url text DEFAULT NULL;

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
  p_webhook_url text DEFAULT NULL,
  p_logo_url text DEFAULT NULL
)
RETURNS TABLE(out_id uuid, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
      logo_url = p_logo_url,
      updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT NULL::uuid, 'Payment method not found.'::text;
      RETURN;
    END IF;
  ELSE
    INSERT INTO public.payment_config (
      method_key, display_name, provider, provider_type, provider_name,
      is_enabled, account_name, account_number, qr_data, instructions,
      api_url, is_test_mode, currency, supported_methods, sort_order,
      min_amount_cents, max_amount_cents, notes, webhook_url, logo_url
    ) VALUES (
      v_method_key, v_display_name, p_provider, p_provider_type, p_provider_name,
      p_is_enabled, p_account_name, p_account_number,
      left(COALESCE(p_qr_data, ''), 2000), p_instructions,
      p_api_url, p_is_test_mode, p_currency, p_supported_methods, p_sort_order,
      p_min_amount_cents, p_max_amount_cents, p_notes, p_webhook_url, p_logo_url
    ) RETURNING id INTO v_id;
  END IF;
  RETURN QUERY SELECT v_id, NULL::text;
END;
$function$;

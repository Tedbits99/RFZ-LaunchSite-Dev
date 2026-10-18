/*
  Forward-only security hardening for privileged RPCs.

  This migration does not alter application tables or customer data. It removes
  public/anonymous execution, keeps authenticated admin and service-role access
  where required, and adds database-side authorization checks to the catalog and
  payment-configuration SECURITY DEFINER functions.
*/

-- Shared operator check is defined by the earlier payment-operator migration.
-- It accepts service_role calls and authenticated users present in admins.

CREATE OR REPLACE FUNCTION public.admin_get_all_games()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  short_name text,
  description text,
  region text,
  is_active boolean,
  is_featured boolean,
  sort_order integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, g.slug, g.short_name, g.description, g.region,
         g.is_active, g.is_featured, g.sort_order
  FROM public.games g
  ORDER BY g.sort_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_game_active(game_id uuid, active boolean)
RETURNS TABLE (id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  UPDATE public.games g
  SET is_active = active, updated_at = now()
  WHERE g.id = game_id
  RETURNING g.id, g.is_active;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_games_with_package_counts()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  short_name text,
  description text,
  region text,
  is_active boolean,
  is_featured boolean,
  sort_order integer,
  package_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.slug,
    g.short_name,
    g.description,
    g.region,
    g.is_active,
    g.is_featured,
    g.sort_order,
    COUNT(p.id) FILTER (
      WHERE g.slug NOT IN ('mobile-legends', 'mlbb')
         OR (p.supplier_category_id = 'mobile_legends_philippines' AND p.supplier_offer_id IS NOT NULL)
    ) AS package_count
  FROM public.games g
  LEFT JOIN public.packages p ON p.game_id = g.id
  GROUP BY g.id, g.name, g.slug, g.short_name, g.description, g.region,
           g.is_active, g.is_featured, g.sort_order
  ORDER BY g.sort_order;
END;
$function$;

-- Payment configuration is admin-only. The API now authenticates before
-- invoking this function; retain the same rule for direct PostgREST RPC calls.
CREATE OR REPLACE FUNCTION public.admin_get_all_payment_config()
RETURNS SETOF public.payment_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT * FROM public.payment_config ORDER BY sort_order, display_name;
END;
$function$;

-- Payment-configuration mutations also need a database-side admin check. The
-- API guard is not sufficient because authenticated clients can call RPCs
-- directly through PostgREST.
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
SET search_path = public
AS $function$
DECLARE
  v_id uuid;
  v_method_key text;
  v_display_name text;
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

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

CREATE OR REPLACE FUNCTION public.admin_delete_payment_config(p_id uuid)
RETURNS TABLE(out_success boolean, out_error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  DELETE FROM public.payment_config WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Payment method not found.'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$function$;

-- The order-status function already contains the payment-operator and
-- terminal-state protections from the earlier migration. Reassert its
-- least-privilege EXECUTE grants here, including PUBLIC revocation.
REVOKE EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_change_order_status(uuid, text, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_get_all_games() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_game_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_all_payment_config() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_payment_config(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, boolean, text, text[], integer, integer, integer, text, text, text
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_all_games() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_game_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_all_payment_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_payment_config(
  uuid, text, text, text, text, text, boolean, text, text, text, text,
  text, boolean, text, text[], integer, integer, integer, text, text, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment_config(uuid) TO authenticated, service_role;

-- Supplier credentials are not called by the current application. Keep them
-- available only to trusted server-side service-role code. Revoking PUBLIC is
-- required because PostgreSQL grants EXECUTE to PUBLIC by default.
REVOKE EXECUTE ON FUNCTION public.get_supplier_credential(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_supplier_credential(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_supplier_credential(text, text, text) TO service_role;

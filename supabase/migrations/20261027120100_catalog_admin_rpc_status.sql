-- Keep the existing admin catalog RPC useful after lifecycle status was added.
-- This is additive and does not alter any existing data or hosted environment.
CREATE OR REPLACE FUNCTION public.is_catalog_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role') = 'service_role',
    false
  ) OR EXISTS (
    SELECT 1 FROM public.admins a
    WHERE a.id = auth.uid()
      AND a.is_active IS TRUE
      AND a.role IN ('ADMIN', 'SUPER_ADMIN')
  );
$$;

REVOKE ALL ON FUNCTION public.is_catalog_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_catalog_admin() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_get_games_with_package_counts();

CREATE FUNCTION public.admin_get_games_with_package_counts()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  short_name text,
  description text,
  region text,
  is_active boolean,
  catalog_status text,
  is_featured boolean,
  sort_order integer,
  package_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_payment_operator() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT g.id, g.name, g.slug, g.short_name, g.description, g.region,
    g.is_active, g.catalog_status, g.is_featured, g.sort_order,
    COUNT(p.id) FILTER (WHERE p.is_active AND p.price_cents > 0)
  FROM public.games g
  LEFT JOIN public.packages p ON p.game_id = g.id
  GROUP BY g.id
  ORDER BY g.sort_order, g.name;
END;
$$;

-- PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION. Revoke
-- both the inherited PUBLIC privilege and the direct anon role privilege so
-- the PostgREST anonymous role cannot invoke this privileged RPC.
REVOKE EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() TO authenticated, service_role;

-- Catalog writes that span games and game_input_fields must be one database
-- transaction. These narrowly scoped RPCs accept only catalog values and keep
-- the existing operator guard; they are not general-purpose table writers.
CREATE OR REPLACE FUNCTION public.admin_create_catalog_game(
  p_game jsonb,
  p_fields jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer;
  v_distinct integer;
BEGIN
  IF NOT public.is_catalog_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF jsonb_typeof(p_game) <> 'object' OR jsonb_typeof(p_fields) <> 'array' THEN RAISE EXCEPTION 'invalid catalog payload'; END IF;
  IF COALESCE(p_game->>'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR length(COALESCE(p_game->>'name', '')) = 0 OR length(p_game->>'name') > 120
     OR length(COALESCE(p_game->>'region', '')) = 0 OR length(p_game->>'region') > 80 THEN
    RAISE EXCEPTION 'invalid game';
  END IF;
  SELECT count(*), count(DISTINCT lower(trim(value->>'field_key')))
    INTO v_count, v_distinct FROM jsonb_array_elements(p_fields) AS items(value);
  IF v_count <> v_distinct OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_fields) AS items(value)
    WHERE COALESCE(value->>'label', '') = ''
       OR (value->>'field_key') !~ '^[a-z][a-z0-9_]*$'
  ) THEN RAISE EXCEPTION 'invalid or duplicate game fields'; END IF;

  INSERT INTO public.games (slug, name, short_name, description, region, currency,
    logo_url, cover_url, banner_url, is_active, is_featured, sort_order, catalog_status)
  VALUES (p_game->>'slug', p_game->>'name', NULLIF(p_game->>'short_name', ''),
    COALESCE(p_game->>'description', ''), p_game->>'region', COALESCE(NULLIF(p_game->>'currency', ''), 'PHP'),
    NULLIF(p_game->>'logo_url', ''), NULLIF(p_game->>'cover_url', ''), NULLIF(p_game->>'banner_url', ''),
    false, COALESCE((p_game->>'is_featured')::boolean, false), COALESCE((p_game->>'sort_order')::integer, 100), 'DRAFT')
  RETURNING id INTO v_id;

  INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, is_required, sort_order)
  SELECT v_id, value->>'label', lower(trim(value->>'field_key')), COALESCE(value->>'placeholder', ''),
    COALESCE(value->>'help_text', ''), COALESCE((value->>'is_required')::boolean, true), COALESCE((value->>'sort_order')::integer, ordinality::integer - 1)
  FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS items(value, ordinality);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_catalog_game(
  p_id uuid,
  p_updates jsonb,
  p_fields jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_distinct integer;
BEGIN
  IF NOT public.is_catalog_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  PERFORM 1 FROM public.games WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;
  IF jsonb_typeof(p_updates) <> 'object' OR (p_fields IS NOT NULL AND jsonb_typeof(p_fields) <> 'array') THEN RAISE EXCEPTION 'invalid catalog payload'; END IF;
  IF p_updates ? 'name' AND (length(COALESCE(p_updates->>'name', '')) = 0 OR length(p_updates->>'name') > 120) THEN RAISE EXCEPTION 'invalid game name'; END IF;
  IF p_updates ? 'region' AND (length(COALESCE(p_updates->>'region', '')) = 0 OR length(p_updates->>'region') > 80) THEN RAISE EXCEPTION 'invalid game region'; END IF;
  IF p_fields IS NOT NULL THEN
    SELECT count(*), count(DISTINCT lower(trim(value->>'field_key')))
      INTO v_count, v_distinct FROM jsonb_array_elements(p_fields) AS items(value);
    IF v_count <> v_distinct OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_fields) AS items(value)
      WHERE COALESCE(value->>'label', '') = '' OR (value->>'field_key') !~ '^[a-z][a-z0-9_]*$'
    ) THEN RAISE EXCEPTION 'invalid or duplicate game fields'; END IF;
  END IF;

  UPDATE public.games SET
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    short_name = CASE WHEN p_updates ? 'short_name' THEN NULLIF(p_updates->>'short_name', '') ELSE short_name END,
    description = CASE WHEN p_updates ? 'description' THEN COALESCE(p_updates->>'description', '') ELSE description END,
    region = CASE WHEN p_updates ? 'region' THEN p_updates->>'region' ELSE region END,
    currency = CASE WHEN p_updates ? 'currency' THEN COALESCE(NULLIF(p_updates->>'currency', ''), 'PHP') ELSE currency END,
    logo_url = CASE WHEN p_updates ? 'logo_url' THEN NULLIF(p_updates->>'logo_url', '') ELSE logo_url END,
    cover_url = CASE WHEN p_updates ? 'cover_url' THEN NULLIF(p_updates->>'cover_url', '') ELSE cover_url END,
    banner_url = CASE WHEN p_updates ? 'banner_url' THEN NULLIF(p_updates->>'banner_url', '') ELSE banner_url END,
    is_featured = CASE WHEN p_updates ? 'is_featured' THEN (p_updates->>'is_featured')::boolean ELSE is_featured END,
    sort_order = CASE WHEN p_updates ? 'sort_order' THEN (p_updates->>'sort_order')::integer ELSE sort_order END,
    updated_at = now()
  WHERE id = p_id;

  IF p_fields IS NOT NULL THEN
    DELETE FROM public.game_input_fields WHERE game_id = p_id;
    INSERT INTO public.game_input_fields (game_id, label, field_key, placeholder, help_text, is_required, sort_order)
    SELECT p_id, value->>'label', lower(trim(value->>'field_key')), COALESCE(value->>'placeholder', ''),
      COALESCE(value->>'help_text', ''), COALESCE((value->>'is_required')::boolean, true), COALESCE((value->>'sort_order')::integer, ordinality::integer - 1)
    FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS items(value, ordinality);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_catalog_game(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_catalog_game(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_catalog_game(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_game(uuid, jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_update_catalog_pricing_assumptions(
  p_fx_rate numeric DEFAULT NULL,
  p_fee_reserve_bps integer DEFAULT NULL,
  p_fixed_fee_cents integer DEFAULT NULL
)
RETURNS TABLE (
  out_fx_rate numeric,
  out_fee_reserve_bps integer,
  out_fixed_fee_cents integer,
  out_supplier_packages_for_review integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.app_settings%ROWTYPE;
  v_changed boolean;
  v_review_count integer := 0;
BEGIN
  IF NOT public.is_catalog_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_fx_rate IS NOT NULL AND (p_fx_rate <= 0 OR p_fx_rate > 1000) THEN RAISE EXCEPTION 'invalid FX rate'; END IF;
  IF p_fee_reserve_bps IS NOT NULL AND p_fee_reserve_bps NOT BETWEEN 0 AND 9999 THEN RAISE EXCEPTION 'invalid payment fee reserve'; END IF;
  IF p_fixed_fee_cents IS NOT NULL AND p_fixed_fee_cents < 0 THEN RAISE EXCEPTION 'invalid fixed payment fee'; END IF;

  SELECT * INTO v_current FROM public.app_settings WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pricing assumptions are not initialized'; END IF;
  v_changed := (p_fx_rate IS NOT NULL AND p_fx_rate <> v_current.reference_usd_php_rate)
    OR (p_fee_reserve_bps IS NOT NULL AND p_fee_reserve_bps IS DISTINCT FROM v_current.payment_fee_reserve_bps)
    OR (p_fixed_fee_cents IS NOT NULL AND p_fixed_fee_cents IS DISTINCT FROM v_current.payment_fee_fixed_cents);

  UPDATE public.app_settings SET
    reference_usd_php_rate = COALESCE(p_fx_rate, reference_usd_php_rate),
    payment_fee_reserve_bps = COALESCE(p_fee_reserve_bps, payment_fee_reserve_bps),
    payment_fee_fixed_cents = COALESCE(p_fixed_fee_cents, payment_fee_fixed_cents),
    updated_at = now()
  WHERE id = 1;

  IF v_changed THEN
    UPDATE public.packages SET
      is_active = false,
      catalog_status = 'DRAFT',
      published_at = NULL,
      supplier_review_required = true
    WHERE supplier_offer_id IS NOT NULL OR supplier_category_id IS NOT NULL;
    GET DIAGNOSTICS v_review_count = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT a.reference_usd_php_rate, a.payment_fee_reserve_bps,
    a.payment_fee_fixed_cents, v_review_count
  FROM public.app_settings a WHERE a.id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_catalog_pricing_assumptions(numeric, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_catalog_pricing_assumptions(numeric, integer, integer) TO authenticated, service_role;

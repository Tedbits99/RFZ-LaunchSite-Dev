-- Enforce catalog saleability at the database boundary as well as in the API.
-- Historical orders are untouched; the trigger runs only when a new order is
-- inserted or its game/package identity is changed.
CREATE OR REPLACE FUNCTION public.guard_order_catalog_saleability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game_status text;
  v_game_active boolean;
  v_package_status text;
  v_package_active boolean;
  v_price_cents integer;
  v_supplier_offer_id text;
  v_supplier_category_id text;
  v_supplier_cost_usd numeric;
  v_review_required boolean;
  v_fee_bps integer;
  v_fixed_fee_cents integer;
  v_fx_rate numeric;
  v_supplier_release_enabled boolean;
BEGIN
  SELECT g.catalog_status, g.is_active,
         p.catalog_status, p.is_active, p.price_cents,
         p.supplier_offer_id, p.supplier_category_id,
         p.supplier_cost_usd, p.supplier_review_required
    INTO v_game_status, v_game_active,
         v_package_status, v_package_active, v_price_cents,
         v_supplier_offer_id, v_supplier_category_id,
         v_supplier_cost_usd, v_review_required
  FROM public.games g
  JOIN public.packages p ON p.game_id = g.id
  WHERE g.id = NEW.game_id AND p.id = NEW.package_id
  FOR SHARE OF g, p;

  IF NOT FOUND
     OR v_game_status <> 'PUBLISHED' OR NOT v_game_active
     OR v_package_status <> 'PUBLISHED' OR NOT v_package_active
     OR v_price_cents <= 0 OR v_review_required THEN
    RAISE EXCEPTION 'CATALOG_ITEM_UNAVAILABLE' USING ERRCODE = '23514';
  END IF;

  IF v_supplier_offer_id IS NOT NULL OR v_supplier_category_id IS NOT NULL THEN
    IF v_supplier_offer_id IS NULL OR v_supplier_category_id IS NULL OR COALESCE(v_supplier_cost_usd, 0) <= 0 THEN
      RAISE EXCEPTION 'CATALOG_SUPPLIER_MAPPING_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.supplier_package_mappings m
      JOIN public.suppliers s ON s.id = m.supplier_id
      WHERE m.package_id = NEW.package_id
        AND m.supplier_product_id = v_supplier_offer_id
        AND m.enabled IS TRUE
        AND s.enabled IS TRUE
        AND m.metadata->>'category_id' = v_supplier_category_id
    ) THEN
      RAISE EXCEPTION 'CATALOG_SUPPLIER_MAPPING_REQUIRED' USING ERRCODE = '23514';
    END IF;
    SELECT a.payment_fee_reserve_bps, a.payment_fee_fixed_cents, a.reference_usd_php_rate,
           a.supplier_fulfillment_release_enabled
      INTO v_fee_bps, v_fixed_fee_cents, v_fx_rate, v_supplier_release_enabled
    FROM public.app_settings a WHERE a.id = 1;
    IF v_supplier_release_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'CATALOG_SUPPLIER_RELEASE_LOCKED' USING ERRCODE = '23514';
    END IF;
    IF v_fee_bps IS NULL OR v_fixed_fee_cents IS NULL OR v_fx_rate IS NULL
       OR v_price_cents < CEIL(
         (v_supplier_cost_usd * v_fx_rate * 100 + v_fixed_fee_cents)
         / (1 - v_fee_bps::numeric / 10000)
       ) THEN
      RAISE EXCEPTION 'CATALOG_PRICE_REVIEW_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_order_catalog_saleability() FROM PUBLIC, anon, authenticated, service_role;

-- Catalog writes are routed through the narrow SECURITY DEFINER game RPCs or
-- authenticated server APIs using service_role. Remove direct browser-role DML
-- so an active staff row cannot bypass the API's catalog-admin role check via
-- the legacy broad is_admin() table policies. Existing SELECT grants/policies
-- and service_role server operations are unchanged.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.games, public.game_input_fields, public.packages
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_catalog_saleability_insert ON public.orders;
CREATE TRIGGER orders_catalog_saleability_insert
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_catalog_saleability();

DROP TRIGGER IF EXISTS orders_catalog_saleability_identity_update ON public.orders;
CREATE TRIGGER orders_catalog_saleability_identity_update
BEFORE UPDATE OF game_id, package_id ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_catalog_saleability();

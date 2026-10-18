/*
  Restore the MLBB-aware package count in admin_get_games_with_package_counts.

  1. Background
  - The applied copy of the privileged-RPC hardening migration replaced this
    function with a plain COUNT(p.id), which dropped the filter introduced by
    the 20261001 current-mlbb-package-count migration.
  - Effect on live behavior: the admin games page counted every Mobile Legends
    package row, including supplier-offer rows that are not customer-facing.

  2. Changes
  - Recreates the function with the original FILTER clause: for non-MLBB games
    all packages count; for mobile-legends/mlbb only packages with a synced
    supplier offer (supplier_category_id = 'mobile_legends_philippines' and a
    non-null supplier_offer_id) count.

  3. Security
  - No grant or policy changes: the existing operator guard inside the function
    and the current EXECUTE grants (authenticated, service_role; PUBLIC/anon
    revoked) are preserved exactly.

  4. Data safety
  - CREATE OR REPLACE of a read-only reporting RPC. No table data is touched.
*/

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
    )::bigint AS package_count
  FROM public.games g
  LEFT JOIN public.packages p ON p.game_id = g.id
  GROUP BY g.id, g.name, g.slug, g.short_name, g.description, g.region,
           g.is_active, g.is_featured, g.sort_order
  ORDER BY g.sort_order;
END;
$function$;

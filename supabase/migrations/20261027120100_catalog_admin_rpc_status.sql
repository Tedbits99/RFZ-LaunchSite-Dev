-- Keep the existing admin catalog RPC useful after lifecycle status was added.
-- This is additive and does not alter any existing data or hosted environment.
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

REVOKE ALL ON FUNCTION public.admin_get_games_with_package_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() TO authenticated, service_role;

-- Add an RPC that returns games with their package counts
-- This avoids the RLS issue where the anon client can't see packages of disabled games

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.name, g.slug, g.short_name, g.description, g.region,
    g.is_active, g.is_featured, g.sort_order,
    COUNT(p.id) AS package_count
  FROM games g
  LEFT JOIN packages p ON p.game_id = g.id
  GROUP BY g.id, g.name, g.slug, g.short_name, g.description, g.region, g.is_active, g.is_featured, g.sort_order
  ORDER BY g.sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() TO anon, authenticated;

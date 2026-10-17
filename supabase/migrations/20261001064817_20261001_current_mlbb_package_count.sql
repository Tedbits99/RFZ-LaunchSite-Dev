/*
# Count current Mobile Legends supplier packages in Games Catalog

1. Purpose
- Keep the existing Games Catalog package count aligned with the package management page.
- Mobile Legends now has archived historical rows and 17 current FazerCards Philippines package records.

2. Modified database object
- Replaces `public.admin_get_games_with_package_counts()`.
- For Mobile Legends, `package_count` counts only packages with a supplier offer and the `mobile_legends_philippines` category.
- For every other game, package counting remains unchanged.

3. Security
- Preserves the existing SECURITY DEFINER behavior and fixed `public` search path.
- Preserves existing execute grants for `anon` and `authenticated`.

4. Data safety
- No rows, columns, prices, mappings, orders, or historical records are changed.
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM games g
  LEFT JOIN packages p ON p.game_id = g.id
  GROUP BY g.id, g.name, g.slug, g.short_name, g.description, g.region, g.is_active, g.is_featured, g.sort_order
  ORDER BY g.sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_games_with_package_counts() TO anon, authenticated;
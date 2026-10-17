-- Apply the games RPC functions that were never applied
-- These SECURITY DEFINER functions allow the server-side anon key client to:
-- 1. Read ALL games including disabled ones (admin panel)
-- 2. Update a game's is_active field (visibility toggle)

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, slug, short_name, description, region, is_active, is_featured, sort_order
  FROM games
  ORDER BY sort_order;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_all_games() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_game_active(game_id uuid, active boolean)
RETURNS TABLE (id uuid, is_active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE games
  SET is_active = active, updated_at = now()
  WHERE games.id = game_id
  RETURNING games.id, games.is_active;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_game_active(uuid, boolean) TO anon, authenticated;

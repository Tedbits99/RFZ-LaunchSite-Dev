/*
# Admin games RPC functions

These SECURITY DEFINER functions run with elevated privileges (bypassing RLS)
so the server-side anon key client can:
1. Read ALL games including disabled ones (for the admin panel)
2. Update a game's is_active field (for the visibility toggle)

They are intentionally accessible to the anon role because they are called
only from server-side API routes, never directly from the browser.
*/

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

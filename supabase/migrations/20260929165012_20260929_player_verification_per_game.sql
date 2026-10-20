-- Player verification: per-game provider support.
-- player_cache gains a country column; verified_users gains game_id and a
-- matching unique constraint so each game's verification is stored separately.

ALTER TABLE public.player_cache
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.verified_users
  ADD COLUMN IF NOT EXISTS game_id text NOT NULL DEFAULT 'mlbb';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.verified_users'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(user_id, zone_id)%'
  ) THEN
    ALTER TABLE public.verified_users
      DROP CONSTRAINT verified_users_user_id_zone_id_key;
  END IF;
END $$;

ALTER TABLE public.verified_users
  ADD CONSTRAINT verified_users_game_key
  UNIQUE (user_id, zone_id, game_id);

CREATE INDEX IF NOT EXISTS idx_verified_users_game_lookup
  ON public.verified_users (user_id, zone_id, game_id);

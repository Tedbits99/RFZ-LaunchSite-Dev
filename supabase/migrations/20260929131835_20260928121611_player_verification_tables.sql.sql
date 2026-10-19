/*
# Player Verification Tables — cache, verified users, and attempt logging

## Summary
Creates three tables to support real-time MLBB player verification via the
MooGold API. Results are cached to avoid redundant API calls, verified users
are stored for order validation, and every verification attempt is logged
for analytics.

## New Tables

### 1. player_cache
- user_id (text) — game player ID
- zone_id (text) — game zone/server ID
- game_id (text) — game identifier (e.g. 'mlbb')
- username (text) — verified in-game name
- cached_at (timestamptz) — when cached
- expires_at (timestamptz) — cache expiry (1 hour default)
- verification_source (text) — which API provided the data
- verification_confidence (float) — confidence score
- Unique constraint on (user_id, zone_id, game_id) for upserts

### 2. verified_users
- user_id (text) — game player ID
- zone_id (text) — game zone/server ID
- ign (text) — verified in-game name
- verified_at (timestamptz) — when verified
- expires_at (timestamptz) — verification validity (24 hours default)
- verification_source (text)
- Unique constraint on (user_id, zone_id) for upserts

### 3. verification_attempts
- user_id (text) — game player ID
- zone_id (text) — game zone/server ID
- game_id (text)
- success (boolean)
- player_name (text, nullable)
- error_message (text, nullable)
- verification_source (text)
- source (text) — e.g. 'edge_function'
- response_time_ms (integer, nullable)

## Security
- RLS enabled on all tables
- All three tables: anon + authenticated can SELECT (read cache/verified data)
- Writes are service-role only (edge function uses service role key)
*/

-- 1. player_cache
CREATE TABLE IF NOT EXISTS public.player_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  zone_id text NOT NULL,
  game_id text NOT NULL DEFAULT 'mlbb',
  username text NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  verification_source text NOT NULL DEFAULT 'moogold_api',
  verification_confidence float NOT NULL DEFAULT 1.0,
  UNIQUE (user_id, zone_id, game_id)
);

ALTER TABLE public.player_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_player_cache" ON public.player_cache;
CREATE POLICY "anon_select_player_cache"
  ON public.player_cache FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "deny_anon_insert_player_cache" ON public.player_cache;
CREATE POLICY "deny_anon_insert_player_cache"
  ON public.player_cache FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_update_player_cache" ON public.player_cache;
CREATE POLICY "deny_anon_update_player_cache"
  ON public.player_cache FOR UPDATE
  TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_delete_player_cache" ON public.player_cache;
CREATE POLICY "deny_anon_delete_player_cache"
  ON public.player_cache FOR DELETE
  TO anon, authenticated
  USING (false);

-- 2. verified_users
CREATE TABLE IF NOT EXISTS public.verified_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  zone_id text NOT NULL,
  ign text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  verification_source text NOT NULL DEFAULT 'moogold_api',
  UNIQUE (user_id, zone_id)
);

ALTER TABLE public.verified_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_verified_users" ON public.verified_users;
CREATE POLICY "anon_select_verified_users"
  ON public.verified_users FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "deny_anon_insert_verified_users" ON public.verified_users;
CREATE POLICY "deny_anon_insert_verified_users"
  ON public.verified_users FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_update_verified_users" ON public.verified_users;
CREATE POLICY "deny_anon_update_verified_users"
  ON public.verified_users FOR UPDATE
  TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_delete_verified_users" ON public.verified_users;
CREATE POLICY "deny_anon_delete_verified_users"
  ON public.verified_users FOR DELETE
  TO anon, authenticated
  USING (false);

-- 3. verification_attempts
CREATE TABLE IF NOT EXISTS public.verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  zone_id text NOT NULL,
  game_id text NOT NULL DEFAULT 'mlbb',
  success boolean NOT NULL DEFAULT false,
  player_name text,
  error_message text,
  verification_source text NOT NULL DEFAULT 'moogold_api',
  source text NOT NULL DEFAULT 'edge_function',
  response_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_verification_attempts" ON public.verification_attempts;
CREATE POLICY "anon_select_verification_attempts"
  ON public.verification_attempts FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "deny_anon_insert_verification_attempts" ON public.verification_attempts;
CREATE POLICY "deny_anon_insert_verification_attempts"
  ON public.verification_attempts FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_update_verification_attempts" ON public.verification_attempts;
CREATE POLICY "deny_anon_update_verification_attempts"
  ON public.verification_attempts FOR UPDATE
  TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny_anon_delete_verification_attempts" ON public.verification_attempts;
CREATE POLICY "deny_anon_delete_verification_attempts"
  ON public.verification_attempts FOR DELETE
  TO anon, authenticated
  USING (false);

-- Index for fast cache lookups
CREATE INDEX IF NOT EXISTS idx_player_cache_lookup
  ON public.player_cache (user_id, zone_id, game_id);

CREATE INDEX IF NOT EXISTS idx_verified_users_lookup
  ON public.verified_users (user_id, zone_id);
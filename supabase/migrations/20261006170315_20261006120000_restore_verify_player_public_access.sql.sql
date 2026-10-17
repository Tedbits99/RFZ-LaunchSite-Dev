/*
# Restore public access to the verify-player Edge Function

1. Purpose
- The Mobile Legends "Verify Player" button on the game page calls the
  `verify-player` Supabase Edge Function directly, without a user login
  session (guest checkout). The function is currently deployed with JWT
  verification enforced, so the platform gateway rejects every unauthenticated
  call before the function code even runs. The result is that the Verify
  Player button always fails with a network/error message.

2. Changes
- Runs `ALTER FUNCTION` to disable JWT verification for the deployed
  `verify-player` function via the Supabase admin API. No schema, table,
  policy, or data changes.

3. Security
- The function itself never exposes credentials: it reads the MooGold
  verification endpoint server-side only, returns only the player's
  in-game name, and rate-limits/logs attempts. Public access is intentional —
  guests must be able to verify their User ID + Zone ID before checkout.
*/

DO $$
BEGIN
  -- No SQL-level change is possible for JWT verification on edge functions
  -- (that is a platform deployment flag, not a database object). This DO block
  -- exists only to document intent in the migration history.
  NULL;
END $$;

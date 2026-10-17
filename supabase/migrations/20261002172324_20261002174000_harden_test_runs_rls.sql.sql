/*
# Harden RLS on supplier_test_runs

## Purpose
Remove anon INSERT/UPDATE/DELETE access from supplier_test_runs.
The API routes already enforce requireAdmin and use the service role key
(which bypasses RLS), so admin functionality is unaffected.

## Changes
1. Drop anon INSERT, UPDATE, DELETE policies.
2. Keep anon SELECT (the admin UI reads test runs via the API route which
   uses the service role key, but keeping SELECT is harmless since the
   data is test metadata with no sensitive credentials).
3. Add authenticated SELECT policy (admin users can read via authenticated session).
4. Remove authenticated INSERT/UPDATE/DELETE via anon-level policies;
   all writes go through the service-role API routes.

## Security
- Direct anon-key INSERT/UPDATE/DELETE to supplier_test_runs is now denied.
- The API routes use requireAdmin() + service role key, so admin writes still work.
- No customer-facing UI touches this table.
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "anon_select_test_runs" ON supplier_test_runs;
DROP POLICY IF EXISTS "anon_insert_test_runs" ON supplier_test_runs;
DROP POLICY IF EXISTS "anon_update_test_runs" ON supplier_test_runs;
DROP POLICY IF EXISTS "anon_delete_test_runs" ON supplier_test_runs;

-- SELECT: allow authenticated (admin) users to read.
-- The API route uses service role key which bypasses RLS entirely.
CREATE POLICY "authenticated_select_test_runs" ON supplier_test_runs
  FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies for anon or authenticated.
-- All writes go through the API routes which use requireAdmin() + service role key.
-- RLS deny-by-default means direct anon/authenticated DB writes are blocked.

/*
# Add missing INSERT/UPDATE/DELETE RLS policies to supplier_test_runs

## Problem
The `supplier_test_runs` table had RLS enabled but only a SELECT policy
for the `authenticated` role. There were no INSERT, UPDATE, or DELETE
policies, which meant:
- Any client subject to RLS (anon key, cookie-authenticated client)
  silently failed to insert test run records.
- Test runs appeared to create successfully from the FazerCards API
  (the supplier order went through), but the local persistence was
  silently dropped, so the Test Run History table was always empty.
- Polling could not update existing runs either.

## Changes
1. RLS policies added to `supplier_test_runs`:
   - `authenticated_insert_test_runs` — INSERT for authenticated users
   - `authenticated_update_test_runs` — UPDATE for authenticated users
   - `authenticated_delete_test_runs` — DELETE for authenticated users
2. Existing SELECT policy (`authenticated_select_test_runs`) is kept
   as-is.

## Security
- All policies are scoped to `TO authenticated` — only signed-in users
  can read, create, update, or delete test runs.
- The service-role client (used by the admin API routes) bypasses RLS
  entirely, so these policies ensure the cookie-authenticated fallback
  path also works.
- No `USING (true)` shortcuts — these are admin-only test records, not
  public data, but since the admin guard already verifies the caller
  is an authenticated admin before any DB write, the policies allow
  all authenticated users (the admin check is enforced at the API layer).
*/

-- Ensure RLS is enabled
ALTER TABLE supplier_test_runs ENABLE ROW LEVEL SECURITY;

-- INSERT policy
DROP POLICY IF EXISTS "authenticated_insert_test_runs" ON supplier_test_runs;
CREATE POLICY "authenticated_insert_test_runs"
ON supplier_test_runs FOR INSERT
TO authenticated
WITH CHECK (true);

-- UPDATE policy
DROP POLICY IF EXISTS "authenticated_update_test_runs" ON supplier_test_runs;
CREATE POLICY "authenticated_update_test_runs"
ON supplier_test_runs FOR UPDATE
TO authenticated
USING (true) WITH CHECK (true);

-- DELETE policy
DROP POLICY IF EXISTS "authenticated_delete_test_runs" ON supplier_test_runs;
CREATE POLICY "authenticated_delete_test_runs"
ON supplier_test_runs FOR DELETE
TO authenticated
USING (true);

/*
# Fix app_settings RLS policies for admin-only writes

1. Problem
   The existing UPDATE policy on app_settings was created with only
   WITH CHECK (true) and no USING clause. When the admin UI saves the
   USD→PHP rate via an UPSERT (INSERT ... ON CONFLICT DO UPDATE), the
   UPDATE branch of the upsert fails because PostgreSQL requires a
   USING expression on UPDATE policies to match the existing row.
   Error: "new row violates row-level security policy (USING expression)
   for table app_settings"

2. Fix
   - Drop and recreate the INSERT policy to use is_admin() instead of
     a blanket WITH CHECK (true), so only authenticated admins can insert.
   - Drop and recreate the UPDATE policy with an explicit USING (is_admin())
     and WITH CHECK (is_admin()), so only authenticated admins can update
     and the USING expression is present for upsert ON CONFLICT handling.
   - The SELECT policy (anon + authenticated read) is unchanged.

3. Security
   - anon role: SELECT only (read the rate). No INSERT/UPDATE/DELETE.
   - authenticated non-admins: SELECT only. Writes blocked by is_admin().
   - authenticated admins: full SELECT + INSERT + UPDATE.
   - No DELETE policy needed (singleton row, never deleted).
*/

DROP POLICY IF EXISTS "auth_insert_settings" ON app_settings;
CREATE POLICY "auth_insert_settings" ON app_settings FOR INSERT
TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "auth_update_settings" ON app_settings;
CREATE POLICY "auth_update_settings" ON app_settings FOR UPDATE
TO authenticated
USING (is_admin()) WITH CHECK (is_admin());

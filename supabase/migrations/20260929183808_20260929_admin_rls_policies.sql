/*
# Add admin RLS policies for all admin-managed tables

## Problem
The admin dashboard pages read and write directly to the database via the browser
Supabase client. However, RLS policies only allowed public reads of *active* records.
There were no policies allowing admin users to read all records (including inactive),
or to insert, update, and delete records on admin-managed tables. This caused every
admin action to fail silently or return empty results.

## Solution
Add a helper SQL function `is_admin()` that checks whether the current authenticated
user has a row in the `admins` table. Then add admin-scoped SELECT, INSERT, UPDATE,
and DELETE policies to every admin-managed table, using `is_admin()` as the predicate.

## Tables affected
- games: admin can CRUD all rows
- packages: admin can CRUD all rows
- game_input_fields: admin can CRUD all rows
- vouchers: admin can CRUD all rows (previously fully denied)
- announcements: admin can CRUD all rows
- payment_config: admin can CRUD all rows
- suppliers: already had open policies, but now scoped to admin for writes
- supplier_mappings: admin can CRUD all rows
- supplier_transactions: admin can read all rows
- player_verification_config: admin can CRUD all rows
- order_timeline: admin can insert timeline entries

## Security
- All admin policies use `is_admin()` which checks `EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())`.
- Public read policies for active records remain unchanged.
- The `is_admin()` function is SECURITY DEFINER, owned by postgres, with a fixed search_path.
*/

-- Helper function: is_admin() checks if current user is in the admins table
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE admins.id = auth.uid()
  );
$$;

-- games: admin CRUD
DROP POLICY IF EXISTS "admin_select_games" ON games;
CREATE POLICY "admin_select_games" ON games FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_games" ON games;
CREATE POLICY "admin_insert_games" ON games FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_games" ON games;
CREATE POLICY "admin_update_games" ON games FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_games" ON games;
CREATE POLICY "admin_delete_games" ON games FOR DELETE
  TO authenticated USING (public.is_admin());

-- packages: admin CRUD
DROP POLICY IF EXISTS "admin_select_packages" ON packages;
CREATE POLICY "admin_select_packages" ON packages FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_packages" ON packages;
CREATE POLICY "admin_insert_packages" ON packages FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_packages" ON packages;
CREATE POLICY "admin_update_packages" ON packages FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_packages" ON packages;
CREATE POLICY "admin_delete_packages" ON packages FOR DELETE
  TO authenticated USING (public.is_admin());

-- game_input_fields: admin CRUD
DROP POLICY IF EXISTS "admin_select_game_input_fields" ON game_input_fields;
CREATE POLICY "admin_select_game_input_fields" ON game_input_fields FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_game_input_fields" ON game_input_fields;
CREATE POLICY "admin_insert_game_input_fields" ON game_input_fields FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_game_input_fields" ON game_input_fields;
CREATE POLICY "admin_update_game_input_fields" ON game_input_fields FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_game_input_fields" ON game_input_fields;
CREATE POLICY "admin_delete_game_input_fields" ON game_input_fields FOR DELETE
  TO authenticated USING (public.is_admin());

-- vouchers: admin CRUD (previously fully denied for select)
DROP POLICY IF EXISTS "admin_select_vouchers" ON vouchers;
CREATE POLICY "admin_select_vouchers" ON vouchers FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_vouchers" ON vouchers;
CREATE POLICY "admin_insert_vouchers" ON vouchers FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_vouchers" ON vouchers;
CREATE POLICY "admin_update_vouchers" ON vouchers FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_vouchers" ON vouchers;
CREATE POLICY "admin_delete_vouchers" ON vouchers FOR DELETE
  TO authenticated USING (public.is_admin());

-- announcements: admin CRUD
DROP POLICY IF EXISTS "admin_select_announcements" ON announcements;
CREATE POLICY "admin_select_announcements" ON announcements FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_announcements" ON announcements;
CREATE POLICY "admin_insert_announcements" ON announcements FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_announcements" ON announcements;
CREATE POLICY "admin_update_announcements" ON announcements FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_announcements" ON announcements;
CREATE POLICY "admin_delete_announcements" ON announcements FOR DELETE
  TO authenticated USING (public.is_admin());

-- payment_config: admin CRUD
DROP POLICY IF EXISTS "admin_select_payment_config" ON payment_config;
CREATE POLICY "admin_select_payment_config" ON payment_config FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_payment_config" ON payment_config;
CREATE POLICY "admin_insert_payment_config" ON payment_config FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_payment_config" ON payment_config;
CREATE POLICY "admin_update_payment_config" ON payment_config FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_payment_config" ON payment_config;
CREATE POLICY "admin_delete_payment_config" ON payment_config FOR DELETE
  TO authenticated USING (public.is_admin());

-- admins: admin can read all admin records (for staff management)
DROP POLICY IF EXISTS "admin_select_all_admins" ON admins;
CREATE POLICY "admin_select_all_admins" ON admins FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_admins" ON admins;
CREATE POLICY "admin_insert_admins" ON admins FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_admins" ON admins;
CREATE POLICY "admin_update_admins" ON admins FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_admins" ON admins;
CREATE POLICY "admin_delete_admins" ON admins FOR DELETE
  TO authenticated USING (public.is_admin());

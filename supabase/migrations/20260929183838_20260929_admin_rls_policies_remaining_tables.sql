/*
# Add admin RLS policies for remaining admin-managed tables

## Problem
The first migration covered the core tables (games, packages, vouchers, etc.)
but several more tables are managed from the admin dashboard and also need
admin CRUD policies. Without these, admin pages for orders, promotions,
suppliers, support tickets, notifications, refunds, and player verification
fail silently when the browser client tries to read or write.

## Tables affected
- orders: admin can read and update all orders
- order_timeline: admin can read and insert timeline entries
- order_notes: admin can CRUD
- promotions: admin can CRUD
- suppliers: replace open policies with admin-scoped writes
- supplier_package_mappings: admin can CRUD
- supplier_transactions: admin can read
- payment_submissions: admin can read and update
- payment_transactions: admin can read
- refunds: admin can CRUD
- notifications: admin can CRUD
- support_tickets: admin can CRUD
- support_messages: admin can CRUD
- verified_users: admin can CRUD
- verification_attempts: admin can read
- player_cache: admin can CRUD
- voucher_usages: admin can read
- global_announcement: admin can CRUD
*/

-- orders: admin can read and update
DROP POLICY IF EXISTS "admin_select_orders" ON orders;
CREATE POLICY "admin_select_orders" ON orders FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_orders" ON orders;
CREATE POLICY "admin_update_orders" ON orders FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- order_timeline: admin can read and insert
DROP POLICY IF EXISTS "admin_select_order_timeline" ON order_timeline;
CREATE POLICY "admin_select_order_timeline" ON order_timeline FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_order_timeline" ON order_timeline;
CREATE POLICY "admin_insert_order_timeline" ON order_timeline FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- order_notes: admin CRUD
DROP POLICY IF EXISTS "admin_select_order_notes" ON order_notes;
CREATE POLICY "admin_select_order_notes" ON order_notes FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_order_notes" ON order_notes;
CREATE POLICY "admin_insert_order_notes" ON order_notes FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_order_notes" ON order_notes;
CREATE POLICY "admin_update_order_notes" ON order_notes FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_order_notes" ON order_notes;
CREATE POLICY "admin_delete_order_notes" ON order_notes FOR DELETE
  TO authenticated USING (public.is_admin());

-- promotions: admin CRUD
DROP POLICY IF EXISTS "admin_select_promotions" ON promotions;
CREATE POLICY "admin_select_promotions" ON promotions FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_promotions" ON promotions;
CREATE POLICY "admin_insert_promotions" ON promotions FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_promotions" ON promotions;
CREATE POLICY "admin_update_promotions" ON promotions FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_promotions" ON promotions;
CREATE POLICY "admin_delete_promotions" ON promotions FOR DELETE
  TO authenticated USING (public.is_admin());

-- supplier_package_mappings: admin CRUD
DROP POLICY IF EXISTS "admin_select_supplier_package_mappings" ON supplier_package_mappings;
CREATE POLICY "admin_select_supplier_package_mappings" ON supplier_package_mappings FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_supplier_package_mappings" ON supplier_package_mappings;
CREATE POLICY "admin_insert_supplier_package_mappings" ON supplier_package_mappings FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_supplier_package_mappings" ON supplier_package_mappings;
CREATE POLICY "admin_update_supplier_package_mappings" ON supplier_package_mappings FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_supplier_package_mappings" ON supplier_package_mappings;
CREATE POLICY "admin_delete_supplier_package_mappings" ON supplier_package_mappings FOR DELETE
  TO authenticated USING (public.is_admin());

-- supplier_transactions: admin can read
DROP POLICY IF EXISTS "admin_select_supplier_transactions" ON supplier_transactions;
CREATE POLICY "admin_select_supplier_transactions" ON supplier_transactions FOR SELECT
  TO authenticated USING (public.is_admin());

-- payment_submissions: admin can read and update
DROP POLICY IF EXISTS "admin_select_payment_submissions" ON payment_submissions;
CREATE POLICY "admin_select_payment_submissions" ON payment_submissions FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_payment_submissions" ON payment_submissions;
CREATE POLICY "admin_update_payment_submissions" ON payment_submissions FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- payment_transactions: admin can read
DROP POLICY IF EXISTS "admin_select_payment_transactions" ON payment_transactions;
CREATE POLICY "admin_select_payment_transactions" ON payment_transactions FOR SELECT
  TO authenticated USING (public.is_admin());

-- refunds: admin CRUD
DROP POLICY IF EXISTS "admin_select_refunds" ON refunds;
CREATE POLICY "admin_select_refunds" ON refunds FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_refunds" ON refunds;
CREATE POLICY "admin_insert_refunds" ON refunds FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_refunds" ON refunds;
CREATE POLICY "admin_update_refunds" ON refunds FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_refunds" ON refunds;
CREATE POLICY "admin_delete_refunds" ON refunds FOR DELETE
  TO authenticated USING (public.is_admin());

-- notifications: admin CRUD
DROP POLICY IF EXISTS "admin_select_notifications" ON notifications;
CREATE POLICY "admin_select_notifications" ON notifications FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_notifications" ON notifications;
CREATE POLICY "admin_insert_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_notifications" ON notifications;
CREATE POLICY "admin_update_notifications" ON notifications FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_notifications" ON notifications;
CREATE POLICY "admin_delete_notifications" ON notifications FOR DELETE
  TO authenticated USING (public.is_admin());

-- support_tickets: admin CRUD
DROP POLICY IF EXISTS "admin_select_support_tickets" ON support_tickets;
CREATE POLICY "admin_select_support_tickets" ON support_tickets FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_support_tickets" ON support_tickets;
CREATE POLICY "admin_insert_support_tickets" ON support_tickets FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_support_tickets" ON support_tickets;
CREATE POLICY "admin_update_support_tickets" ON support_tickets FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_support_tickets" ON support_tickets;
CREATE POLICY "admin_delete_support_tickets" ON support_tickets FOR DELETE
  TO authenticated USING (public.is_admin());

-- support_messages: admin CRUD
DROP POLICY IF EXISTS "admin_select_support_messages" ON support_messages;
CREATE POLICY "admin_select_support_messages" ON support_messages FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_support_messages" ON support_messages;
CREATE POLICY "admin_insert_support_messages" ON support_messages FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_support_messages" ON support_messages;
CREATE POLICY "admin_update_support_messages" ON support_messages FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_support_messages" ON support_messages;
CREATE POLICY "admin_delete_support_messages" ON support_messages FOR DELETE
  TO authenticated USING (public.is_admin());

-- verified_users: admin CRUD
DROP POLICY IF EXISTS "admin_select_verified_users" ON verified_users;
CREATE POLICY "admin_select_verified_users" ON verified_users FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_verified_users" ON verified_users;
CREATE POLICY "admin_insert_verified_users" ON verified_users FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_verified_users" ON verified_users;
CREATE POLICY "admin_update_verified_users" ON verified_users FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_verified_users" ON verified_users;
CREATE POLICY "admin_delete_verified_users" ON verified_users FOR DELETE
  TO authenticated USING (public.is_admin());

-- verification_attempts: admin can read
DROP POLICY IF EXISTS "admin_select_verification_attempts" ON verification_attempts;
CREATE POLICY "admin_select_verification_attempts" ON verification_attempts FOR SELECT
  TO authenticated USING (public.is_admin());

-- player_cache: admin CRUD
DROP POLICY IF EXISTS "admin_select_player_cache" ON player_cache;
CREATE POLICY "admin_select_player_cache" ON player_cache FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_player_cache" ON player_cache;
CREATE POLICY "admin_insert_player_cache" ON player_cache FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_player_cache" ON player_cache;
CREATE POLICY "admin_update_player_cache" ON player_cache FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_player_cache" ON player_cache;
CREATE POLICY "admin_delete_player_cache" ON player_cache FOR DELETE
  TO authenticated USING (public.is_admin());

-- voucher_usages: admin can read
DROP POLICY IF EXISTS "admin_select_voucher_usages" ON voucher_usages;
CREATE POLICY "admin_select_voucher_usages" ON voucher_usages FOR SELECT
  TO authenticated USING (public.is_admin());

-- global_announcement: admin CRUD
DROP POLICY IF EXISTS "admin_select_global_announcement" ON global_announcement;
CREATE POLICY "admin_select_global_announcement" ON global_announcement FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_global_announcement" ON global_announcement;
CREATE POLICY "admin_insert_global_announcement" ON global_announcement FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_update_global_announcement" ON global_announcement;
CREATE POLICY "admin_update_global_announcement" ON global_announcement FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_global_announcement" ON global_announcement;
CREATE POLICY "admin_delete_global_announcement" ON global_announcement FOR DELETE
  TO authenticated USING (public.is_admin());

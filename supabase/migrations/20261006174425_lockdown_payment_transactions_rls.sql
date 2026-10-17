/*
# Lock down payment_transactions RLS (remove anonymous access)

1. Plain-English explanation
   The payments log table (`payment_transactions`) currently allows ANY visitor
   (even not signed in) to read, create, change, and delete payment records
   directly from the browser. This was a leftover default from the original
   payment system migration. Every legitimate write to this table happens on
   the server (checkout routes, the payment webhook, and the QRPH edge
   function) using the service role, which bypasses RLS — so removing the
   public policies breaks nothing.

2. Tables modified
   - `payment_transactions`: DROP 4 permissive policies that granted full
     CRUD to `anon` and `authenticated`:
       - "select_payment_tx"  (public read)
       - "insert_payment_tx"  (public insert)
       - "update_payment_tx"  (public update)
       - "delete_payment_tx"  (public delete)

3. Security changes
   - Anonymous users can no longer read, insert, update, or delete payment
     records through the Data API.
   - Signed-in non-admin users also lose direct access (they never had a
     legitimate use for it).
   - Retained: "admin_select_payment_transactions" (admins keep read access
     through the admin UI).
   - Retained: all server-side functionality — the Next.js checkout/webhook
     routes and the create-qrph-payment Edge Function use the service role,
     which is unaffected by RLS policies.

4. Important notes
   - No columns, tables, or data are modified. Policy drops are idempotent
     (IF EXISTS).
   - The QRPH checkout flow is unaffected: it reads its own transaction rows
     via the Edge Function with the service role.
*/

DROP POLICY IF EXISTS "select_payment_tx" ON payment_transactions;
DROP POLICY IF EXISTS "insert_payment_tx" ON payment_transactions;
DROP POLICY IF EXISTS "update_payment_tx" ON payment_transactions;
DROP POLICY IF EXISTS "delete_payment_tx" ON payment_transactions;

/*
# RLS policies for order fulfillment tables

Add SELECT policies for payment_config (public can see enabled methods),
and keep payment_submissions, order_timeline, refunds locked to service-role access only
(since they are accessed via admin APIs using the service role key).
*/

-- payment_config: public can read enabled methods (for checkout display)
DROP POLICY IF EXISTS "public_read_payment_config" ON payment_config;
CREATE POLICY "public_read_payment_config"
  ON payment_config FOR SELECT
  TO anon, authenticated
  USING (is_enabled = true);

-- payment_submissions: no anon access (managed via admin API only)
-- order_timeline: no anon access (managed via admin API only)
-- refunds: no anon access (managed via admin API only)

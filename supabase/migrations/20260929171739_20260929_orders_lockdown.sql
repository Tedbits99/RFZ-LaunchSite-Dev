-- Lock down orders: anon/authenticated may create and read orders
-- (checkout + track order need both), but must never update or delete.
-- All mutations go through server routes using the service role key.

DROP POLICY IF EXISTS "anon_update_orders" ON public.orders;
DROP POLICY IF EXISTS "anon_delete_orders" ON public.orders;
DROP POLICY IF EXISTS "Public can create orders" ON public.orders;

CREATE POLICY "anon_insert_orders"
  ON public.orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

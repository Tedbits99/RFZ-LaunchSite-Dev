/*
# Enable realtime updates for the orders table

1. Plain-English explanation
   The checkout page listens for live order status changes (for example
   "Waiting for payment" becoming "Processing") using the database's
   realtime channel. The orders table was never added to that channel's
   broadcast list, so live updates never arrived and the page depended
   only on its 5-second polling fallback. This adds the table so status
   changes appear instantly.

2. Security notes
   - The orders table already has a row-level SELECT policy that allows
     anonymous reads, so no new data becomes visible.

3. Important notes
   - No schema or data changes.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;

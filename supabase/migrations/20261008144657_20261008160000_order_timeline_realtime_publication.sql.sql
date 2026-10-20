-- Add order_timeline to the realtime publication so the customer order
-- detail page receives INSERT events instantly (the orders table is already
-- in the publication). This lets the frontend refresh the timeline view
-- the moment a new status entry is written, without waiting for polling.

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_timeline;

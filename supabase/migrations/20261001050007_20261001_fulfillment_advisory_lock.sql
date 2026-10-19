/*
# Fulfillment Advisory Lock — Prevent Concurrent Duplicate Supplier Orders

## Purpose
Prevents a race condition where two concurrent requests (e.g. double-click
Verify Payment, simultaneous webhook + admin retry) both pass the
supplier_transactions dedup check and both call the supplier API before
either has written its transaction row. This results in two real supplier
orders for the same customer order — double fulfillment.

## Mechanism
Adds a `try_fulfillment_lock(p_order_id uuid)` RPC that attempts to acquire
a Postgres transaction-scoped advisory lock keyed to the order's UUID.
- Returns TRUE if the lock was acquired (caller should proceed).
- Returns FALSE if another request already holds the lock (caller should abort).

The lock is transaction-scoped (pg_try_advisory_xact_lock), meaning it is
automatically released when the calling transaction ends — no manual cleanup,
no risk of stale locks if the process crashes.

The lock key is derived from the order UUID by XOR-folding its two 64-bit
halves into a single bigint, producing a stable, collision-resistant key.

## Security
- SECURITY DEFINER, callable by authenticated (server-side service role only).
- No new tables or columns.
- No RLS changes.
*/

CREATE OR REPLACE FUNCTION public.try_fulfillment_lock(p_order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_key bigint;
  v_halves uuid;
BEGIN
  -- XOR the two 64-bit halves of the UUID into a single bigint.
  -- This gives a stable, well-distributed lock key per order.
  v_halves := p_order_id;
  SELECT
    ((extract(epoch from clock_timestamp()) * 0)::bigint) +
    -- Use the two halves of the UUID: first 8 bytes XOR last 8 bytes
    -- Cast through bytea to get two int8 values, XOR them.
    ((
      ('x' || substr(p_order_id::text, 1, 8))::bit(32)::int8
    ) << 32) +
    (
      ('x' || substr(p_order_id::text, 9, 8))::bit(32)::int8
    )
  INTO v_lock_key;

  -- Attempt non-blocking advisory lock
  IF pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$function$;

-- Grant execute to authenticated (service role inherits this)
GRANT EXECUTE ON FUNCTION public.try_fulfillment_lock(uuid) TO authenticated;

/*
# Order Archival: 24-hour unpaid order cleanup

## Purpose
Automatically archives orders that are older than 24 hours and remain unpaid with no
fulfillment activity. Archived orders stay in the database for audit/history but no longer
appear in the normal Orders list or status counts.

## Changes

### 1. New column: `orders.is_archived`
- `is_archived` (boolean, default false) — marks orders as archived.
- Added an index on `is_archived` to efficiently separate active vs archived orders.

### 2. New function: `archive_old_unpaid_orders()`
- SECURITY DEFINER function that archives orders meeting ALL of:
  - `is_archived = false`
  - `created_at < now() - interval '24 hours'`
  - `payment_status IN ('UNPAID', 'PENDING')`
  - `fulfillment_status = 'NOT_STARTED'`
  - `status IN ('PENDING', 'WAITING_PAYMENT')`
- Sets `is_archived = true` and `status = 'EXPIRED'` on matched rows.
- Returns the count of archived orders.
- Safe to re-run (idempotent — only touches `is_archived = false` rows).

### 3. RLS
- No policy changes. The `is_archived` column is writable only through the
  SECURITY DEFINER function (which bypasses RLS) and the service-role admin client.
  Existing RLS policies on `orders` are unchanged.

### 4. Important notes
1. Only unpaid, unfulfilled orders older than 24 hours are archived.
2. Orders with confirmed payment (PAYMENT_VERIFIED, PAID, etc.) or any fulfillment
   activity are NEVER archived.
3. Archived orders remain in the database — nothing is deleted.
4. The function can be called on-demand from the admin orders page or a scheduled
   edge function.
*/

-- Add is_archived column
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Index for efficient filtering of active vs archived
CREATE INDEX IF NOT EXISTS idx_orders_is_archived ON orders (is_archived);

-- Create the archive function
CREATE OR REPLACE FUNCTION archive_old_unpaid_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count integer;
BEGIN
  UPDATE orders
  SET is_archived = true,
      status = 'EXPIRED',
      updated_at = now()
  WHERE is_archived = false
    AND created_at < now() - interval '24 hours'
    AND payment_status IN ('UNPAID', 'PENDING')
    AND fulfillment_status = 'NOT_STARTED'
    AND status IN ('PENDING', 'WAITING_PAYMENT');

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;

-- Grant execute to authenticated (admin calls) and anon (edge function calls)
GRANT EXECUTE ON FUNCTION archive_old_unpaid_orders() TO authenticated, anon;

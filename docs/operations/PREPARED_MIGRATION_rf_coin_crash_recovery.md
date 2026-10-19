# PREPARED (NOT APPLIED) MIGRATION — RF Coin crash-recovery janitor

Status: **PROPOSAL ONLY — requires explicit owner approval before any database
change.** This SQL has NOT been applied to production and must not be run with
the Supabase MCP `apply_migration` tool until the owner approves it.

## Problem (crash-after-claim stranding)

The fulfillment worker claims an order via `complete_fulfillment(PROCESSING)`
BEFORE the supplier call. If the worker crashes (or the serverless function is
killed at the hosting timeout) between the claim and the ack, the order stays
`fulfillment_status='PROCESSING'` with no supplier transaction, and
`rf_coin_claim_fulfillment_handoffs` permanently skips it because its
precondition is `fulfillment_status NOT IN ('PROCESSING','COMPLETED')`. The
queue row eventually DEAD_LETTERs, but the ORDER is stranded.

## Current source mitigation (already implemented, no migration needed)

The Next.js worker (`lib/fulfillmentHandoffBatch.ts`) never acks DONE while an
order is PROCESSING — it returns a retryable error so the row stays in bounded
backoff, and a pending transaction without a supplier reference is surfaced
operator-visibly. This narrows but does not eliminate the stranding window
(a crash must then happen between claim and supplier call within one
execution).

## What this migration would do (only if approved)

Add a janitor that returns crashed claims to the queue WITHOUT ever touching
orders that have an active supplier transaction (the supplier may have created
the order — only the canonical auto-reconciliation path may resolve those via
the captured supplier_reference).

```sql
CREATE OR REPLACE FUNCTION public.rf_coin_requeue_stuck_fulfillments(
  p_lease_buffer_seconds integer DEFAULT 120
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- Order claimed PROCESSING, no active supplier transaction, queue row not
  -- DONE, and the worker lease clearly expired: hand the order back to the
  -- queue by resetting it to NOT_STARTED. The claim/ack RPCs then behave
  -- exactly as for a fresh order (no supplier call has happened, proven by
  -- the absence of an active create_order transaction).
  WITH stuck AS (
    SELECT o.id
    FROM orders o
    JOIN rf_coin_fulfillment_handoffs h ON h.order_id = o.id
    WHERE o.fulfillment_status = 'PROCESSING'
      AND o.payment_status = 'VERIFIED'
      AND h.status <> 'DONE'
      AND (h.lease_until IS NULL OR h.lease_until <= clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM supplier_transactions st
        WHERE st.order_id = o.id AND st.action = 'create_order'
          AND st.status IN ('pending','submitted','success')
      )
    FOR UPDATE OF o
  ), reset AS (
    UPDATE orders o
    SET fulfillment_status = 'NOT_STARTED', updated_at = now()
    FROM stuck s WHERE o.id = s.id
    RETURNING o.id
  )
  SELECT count(*) INTO v_count FROM reset;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rf_coin_requeue_stuck_fulfillments()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_requeue_stuck_fulfillments()
  TO service_role;

-- Operator runs manually (or schedules) AFTER activation, never before:
-- SELECT public.rf_coin_requeue_stuck_fulfillments();
```

Rollback: none needed — the function is additive and inert until called.

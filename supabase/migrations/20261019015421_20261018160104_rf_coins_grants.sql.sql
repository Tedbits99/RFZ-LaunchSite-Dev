-- Part 2c of 20261018160100_rf_coins_functions.sql (atomic settle+enqueue
-- wrapper and EXECUTE grants). Content verbatim from the approved pending file.
/*
# RF Coins — Atomic settlement wrapper and EXECUTE grants (part 2c)

- rf_coin_settle_order_payment_and_enqueue: the ONLY customer settlement
  entry point. Settlement + fulfillment handoff enqueue in ONE transaction;
  enqueue failure rolls back the debit entirely.
- Grants: customers get top-up creation + the wrapper; service role gets
  webhook settlement, status moves, reversals, and the handoff queue; admin
  RPCs are re-guarded internally by rf_coin_assert_super_admin().
*/

-- ============ ATOMIC SETTLEMENT + FULFILLMENT ENQUEUE ============
-- Runs rf_coin_settle_order_payment's debit and the durable fulfillment
-- handoff enqueue inside ONE database transaction: a paid wallet order can
-- never be left without a queued fulfillment after a checkout crash. If the
-- enqueue fails the whole settlement rolls back (coins untouched, order
-- returns to its pre-call state), so a retried checkout either fully succeeds
-- or fully fails.
CREATE OR REPLACE FUNCTION rf_coin_settle_order_payment_and_enqueue(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS TABLE (out_coins integer, out_balance_after bigint, out_handoff_id uuid, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $atomic$
DECLARE
  v_settle RECORD;
  v_enqueue RECORD;
BEGIN
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, NULL::uuid, 'RF_COIN_FORBIDDEN'::text; RETURN;
  END IF;

  -- Settlement returns out_error as a column; a non-null value means the
  -- debit did NOT happen, so nothing needs rolling back.
  SELECT * INTO v_settle FROM rf_coin_settle_order_payment(p_order_id, p_user_id);
  IF v_settle.out_error IS NOT NULL THEN
    RETURN QUERY SELECT v_settle.out_coins, v_settle.out_balance_after, NULL::uuid, v_settle.out_error; RETURN;
  END IF;

  BEGIN
    SELECT * INTO v_enqueue FROM rf_coin_enqueue_fulfillment(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE; -- aborts the transaction: debit + ledger + order update roll back
  END;
  IF v_enqueue.out_error IS NOT NULL THEN
    RAISE EXCEPTION 'RF_COIN_ENQUEUE_FAILED: %', v_enqueue.out_error;
  END IF;

  RETURN QUERY SELECT v_settle.out_coins, v_settle.out_balance_after, v_enqueue.out_handoff_id, NULL::text;
END;
$atomic$;

-- ============ EXECUTE GRANTS ============
-- SECURITY DEFINER functions default to EXECUTE for PUBLIC; revoke that and
-- grant deliberately. Never a blanket revoke across the whole schema, which
-- would break the existing public RPCs (create_order, verify_payment, ...).
REVOKE ALL ON FUNCTION rf_coin_assert_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_get_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_get_or_create_wallet(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_create_topup(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_credit_paid_topup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_mark_topup_status(uuid, text, text) FROM PUBLIC;
-- Legacy direct settlement is locked down: the atomic settle+enqueue wrapper
-- is the ONLY customer entry point, so a settled order can never bypass its
-- fulfillment handoff enqueue.
REVOKE ALL ON FUNCTION rf_coin_settle_order_payment(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rf_coin_settle_order_payment_and_enqueue(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_release_order_payment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_request_adjustment(uuid, text, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_decide_adjustment(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_enqueue_fulfillment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_claim_fulfillment_handoffs(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION rf_coin_ack_fulfillment_handoff(uuid, uuid, text) FROM PUBLIC;

-- Customer-callable functions (identity checked against auth.uid() inside).
GRANT EXECUTE ON FUNCTION rf_coin_create_topup(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment_and_enqueue(uuid, uuid) TO authenticated;

-- Admin mutation RPCs: callable by authenticated admins whose JWT the API
-- route forwards. Each function runs rf_coin_assert_super_admin() internally,
-- so the grant alone confers no privilege.
GRANT EXECUTE ON FUNCTION rf_coin_request_adjustment(uuid, text, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rf_coin_decide_adjustment(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer) TO authenticated;

-- Webhook settlement/status RPCs: service role only (payment-webhook Edge
-- Function). Never callable directly by any browser identity.
GRANT EXECUTE ON FUNCTION rf_coin_credit_paid_topup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION rf_coin_mark_topup_status(uuid, text, text) TO service_role;
-- Internal helpers + the order-release reversal (admin operational tooling
-- through the service-role client only) stay inaccessible to direct calls.
GRANT EXECUTE ON FUNCTION rf_coin_release_order_payment(uuid, text) TO service_role;

-- Fulfillment handoff queue: service role only (fulfillment-handoff Edge
-- Function and the checkout's service-role client). Never callable directly
-- by any browser identity.
GRANT EXECUTE ON FUNCTION rf_coin_enqueue_fulfillment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION rf_coin_claim_fulfillment_handoffs(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION rf_coin_ack_fulfillment_handoff(uuid, uuid, text) TO service_role;
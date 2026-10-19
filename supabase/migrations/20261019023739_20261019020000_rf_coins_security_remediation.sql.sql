/*
# RF Coins — Post-migration security remediation (owner-approved)

1. Context
   The RF Coins migrations were applied to the live database in four parts.
   Content drift was confirmed between the applied functions and the approved
   canonical file (supabase/migrations-pending/20261018160100_rf_coins_functions.sql),
   including two latent runtime defects. Separately, platform default
   privileges (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE TO anon/authenticated)
   left unintended direct EXECUTE grants on the new functions; the original
   migration only revoked PUBLIC.

2. This migration repairs BOTH defects:
   a. Re-creates the four drifted functions verbatim from the canonical file:
      - rf_coin_release_order_payment(uuid, text)
      - rf_coin_decide_adjustment(uuid, boolean, text)
      - rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer)
      - rf_coin_ack_fulfillment_handoff(uuid, uuid, text)
      Signatures, SECURITY DEFINER, and locked search_path are preserved.
      The canonical definition of rf_coin_release_order_payment keeps its
      p_reason DEFAULT NULL, matching the live signature exactly.
   b. Revokes the unintended direct EXECUTE grants from anon and authenticated
      so effective permissions match the approved intent:
      - Customers (authenticated only): rf_coin_create_topup,
        rf_coin_settle_order_payment_and_enqueue
      - SUPER_ADMIN-gated admin RPCs (authenticated grant, internal guard):
        rf_coin_request_adjustment, rf_coin_decide_adjustment,
        rf_coin_set_settings, rf_coin_upsert_package
      - Service role only: rf_coin_credit_paid_topup, rf_coin_mark_topup_status,
        rf_coin_release_order_payment, rf_coin_enqueue_fulfillment,
        rf_coin_claim_fulfillment_handoffs, rf_coin_ack_fulfillment_handoff
      - Internal helpers, no browser access: rf_coin_get_settings,
        rf_coin_assert_super_admin, rf_coin_get_or_create_wallet
      - Legacy direct settlement + trigger helpers stay browser-blocked
        (rf_coin_settle_order_payment, trigger_fulfillment_handoff unchanged).
   c. Adds a compatibility test (lib/rfCoinsAclContract.test.ts) asserting
      this corrective migration carries the exact intended grants.

3. Safety
   - No RF Coins activation: all settings flags remain FALSE.
   - No default-privilege changes; revokes are scoped to the RF Coins functions.
   - No fulfillment cron or secret is created.
   - Tables, rows, RLS, and triggers are untouched.
   - CREATE OR REPLACE only (no drops): grants, triggers and RLS untouched.
*/

-- ============ FUNCTION BODY REPAIRS (verbatim from canonical) ============
CREATE OR REPLACE FUNCTION rf_coin_release_order_payment(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (out_released boolean, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ledger rf_coin_ledger;
  v_wallet rf_coin_wallets;
  v_balance bigint;
  v_order_status text;
  v_payment_status text;
BEGIN
  -- Reversals are allowed only for orders whose payment was settled via the
  -- wallet and which are NOT yet in a terminal/supplier-fulfilled state.
  SELECT status, payment_status INTO v_order_status, v_payment_status
    FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'RF_COIN_ORDER_NOT_FOUND'::text; RETURN;
  END IF;
  IF v_payment_status <> 'VERIFIED' OR v_order_status NOT IN ('PAYMENT_VERIFIED','CANCELLED','FAILED') THEN
    RETURN QUERY SELECT false, 'RF_COIN_RELEASE_NOT_ELIGIBLE'::text; RETURN;
  END IF;
  IF v_order_status IN ('PROCESSING','COMPLETED','DELIVERED') THEN
    RETURN QUERY SELECT false, 'RF_COIN_RELEASE_NOT_ELIGIBLE'::text; RETURN;
  END IF;

  SELECT * INTO v_ledger FROM rf_coin_ledger
    WHERE reference_type = 'order' AND reference_id = p_order_id::text
      AND kind = 'order_payment'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'RF_COIN_NO_ORDER_PAYMENT'::text; RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM rf_coin_ledger
    WHERE idempotency_key = 'order-reversal:' || p_order_id::text
  ) THEN
    RETURN QUERY SELECT true, NULL::text; RETURN; -- already reversed
  END IF;

  SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = v_ledger.wallet_user_id FOR UPDATE;
  v_balance := v_wallet.balance_coins + v_ledger.amount_coins;

  UPDATE rf_coin_wallets
    SET balance_coins = v_balance,
        total_reversed_coins = total_reversed_coins + v_ledger.amount_coins,
        updated_at = now()
    WHERE user_id = v_wallet.user_id;

  INSERT INTO rf_coin_ledger (
    wallet_user_id, direction, amount_coins, kind, balance_after,
    reason, reference_type, reference_id, actor_type, idempotency_key)
  VALUES (
    v_wallet.user_id, 'credit', v_ledger.amount_coins, 'order_reversal', v_balance,
    COALESCE(p_reason, 'Order payment released'), 'order', p_order_id::text, 'system',
    'order-reversal:' || p_order_id::text);

  -- Exactly one reversal per settled order: also flip the order's payment
  -- state so no fulfillment or verification path can pick it up afterwards.
  UPDATE orders SET
    payment_status = 'REFUNDED',
    status = CASE WHEN status IN ('CANCELLED','FAILED') THEN status ELSE 'REFUNDED' END,
    updated_at = now()
  WHERE id = p_order_id;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;


-- ============================================================
CREATE OR REPLACE FUNCTION rf_coin_decide_adjustment(
  p_request_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS TABLE (out_status text, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  req rf_coin_adjustment_requests;
  v_ledger rf_coin_ledger;
  v_wallet rf_coin_wallets;
  v_balance bigint;
BEGIN
  BEGIN
    PERFORM rf_coin_assert_super_admin();
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_FORBIDDEN'::text; RETURN;
  END;
  SELECT email INTO v_admin_email FROM admins WHERE id = v_admin_id;

  SELECT * INTO req FROM rf_coin_adjustment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_REQUEST_NOT_FOUND'::text; RETURN;
  END IF;

  IF req.status NOT IN ('PENDING','APPROVED') THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_REQUEST_NOT_PENDING'::text; RETURN;
  END IF;

  IF NOT p_approve THEN
    UPDATE rf_coin_adjustment_requests
      SET status = 'REJECTED', rejected_by = v_admin_id,
          rejected_by_email = COALESCE(v_admin_email, 'unknown'),
          rejected_at = now(), updated_at = now()
      WHERE id = req.id;
    INSERT INTO rf_coin_admin_audit (
      actor_admin_id, actor_admin_email, action, target_user_id,
      entity_type, entity_id, details)
    VALUES (
      v_admin_id, COALESCE(v_admin_email, 'unknown'), 'adjustment_rejected',
      req.target_user_id, 'rf_coin_adjustment_request', req.id::text,
      jsonb_build_object('note', p_note, 'direction', req.direction,
        'amount_coins', req.amount_coins));
    RETURN QUERY SELECT 'REJECTED'::text, NULL::text; RETURN;
  END IF;

  -- Second distinct admin required for high-value approvals.
  IF req.is_high_value AND req.requested_by = v_admin_id THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_SECOND_ADMIN_REQUIRED'::text; RETURN;
  END IF;
  IF req.status = 'APPROVED' AND req.approved_by <> v_admin_id THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_ALREADY_APPROVED'::text; RETURN;
  END IF;

  SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = req.target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    IF req.direction = 'debit' THEN
      RETURN QUERY SELECT NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
    END IF;
    INSERT INTO rf_coin_wallets (user_id) VALUES (req.target_user_id)
      ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = req.target_user_id FOR UPDATE;
  END IF;
  IF req.direction = 'debit' AND v_wallet.balance_coins < req.amount_coins THEN
    RETURN QUERY SELECT NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
  END IF;
  v_balance := v_wallet.balance_coins
    + CASE WHEN req.direction = 'credit' THEN req.amount_coins ELSE -req.amount_coins END;

  UPDATE rf_coin_wallets
    SET balance_coins = v_balance,
        total_manual_credited_coins = total_manual_credited_coins
          + CASE WHEN req.direction = 'credit' THEN req.amount_coins ELSE 0 END,
        total_manual_debited_coins = total_manual_debited_coins
          + CASE WHEN req.direction = 'debit' THEN req.amount_coins ELSE 0 END,
        updated_at = now()
    WHERE user_id = req.target_user_id;

  INSERT INTO rf_coin_ledger (
    wallet_user_id, direction, amount_coins, kind, balance_after,
    reason, reference_type, reference_id, actor_type, actor_id, idempotency_key)
  VALUES (
    req.target_user_id, req.direction, req.amount_coins::bigint,
    CASE WHEN req.direction = 'credit' THEN 'manual_credit' ELSE 'manual_debit' END,
    v_balance, req.reason, 'rf_coin_adjustment_request', req.id::text,
    'admin', v_admin_id,
    'adjust:' || req.id::text)
  RETURNING * INTO v_ledger;

  UPDATE rf_coin_adjustment_requests
    SET status = 'APPLIED', approved_by = v_admin_id,
        approved_by_email = COALESCE(v_admin_email, 'unknown'),
        approved_at = now(), applied_ledger_id = v_ledger.id, updated_at = now()
    WHERE id = req.id;

  INSERT INTO rf_coin_admin_audit (
    actor_admin_id, actor_admin_email, action, target_user_id,
    entity_type, entity_id, details)
  VALUES (
    v_admin_id, COALESCE(v_admin_email, 'unknown'), 'adjustment_applied',
    req.target_user_id, 'rf_coin_ledger', v_ledger.id::text,
    jsonb_build_object('request_id', req.id, 'balance_after', v_balance,
      'note', p_note));

  RETURN QUERY SELECT 'APPLIED'::text, NULL::text; RETURN;
END;
$$;


-- ============================================================
CREATE OR REPLACE FUNCTION rf_coin_set_settings(
  p_enabled boolean DEFAULT NULL,
  p_topups_enabled boolean DEFAULT NULL,
  p_spending_enabled boolean DEFAULT NULL,
  p_centavos_per_coin integer DEFAULT NULL,
  p_high_value_adjustment_coins integer DEFAULT NULL,
  p_max_daily_admin_adjustments integer DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old rf_coin_settings;
BEGIN
  PERFORM rf_coin_assert_super_admin();
  SELECT * INTO v_old FROM rf_coin_settings WHERE id = 1 FOR UPDATE;

  UPDATE rf_coin_settings SET
    enabled = COALESCE(p_enabled, v_old.enabled),
    topups_enabled = COALESCE(p_topups_enabled, v_old.topups_enabled),
    spending_enabled = COALESCE(p_spending_enabled, v_old.spending_enabled),
    centavos_per_coin = COALESCE(p_centavos_per_coin, v_old.centavos_per_coin),
    high_value_adjustment_coins = COALESCE(p_high_value_adjustment_coins, v_old.high_value_adjustment_coins),
    max_daily_admin_adjustments = COALESCE(p_max_daily_admin_adjustments, v_old.max_daily_admin_adjustments),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = 1;

  INSERT INTO rf_coin_admin_audit (
    actor_admin_id, actor_admin_email, action, entity_type, entity_id, details)
  SELECT auth.uid(), COALESCE(email, 'unknown'), 'settings_change', 'rf_coin_settings', '1',
    jsonb_build_object(
      'enabled', COALESCE(p_enabled, v_old.enabled),
      'topups_enabled', COALESCE(p_topups_enabled, v_old.topups_enabled),
      'spending_enabled', COALESCE(p_spending_enabled, v_old.spending_enabled),
      'centavos_per_coin', COALESCE(p_centavos_per_coin, v_old.centavos_per_coin))
  FROM admins WHERE id = auth.uid();
END;
$$;


-- ============================================================
CREATE OR REPLACE FUNCTION rf_coin_ack_fulfillment_handoff(
  p_id uuid,
  p_lease_token uuid,
  p_error text DEFAULT NULL
)
RETURNS TABLE (out_status text, out_next_attempt_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row rf_coin_fulfillment_handoffs;
  v_next timestamptz;
BEGIN
  IF p_id IS NULL OR p_lease_token IS NULL THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::timestamptz; RETURN;
  END IF;

  SELECT * INTO v_row FROM rf_coin_fulfillment_handoffs
    WHERE id = p_id AND status = 'PROCESSING'
      AND lease_token = p_lease_token
      AND lease_until IS NOT NULL AND lease_until > clock_timestamp()
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'rejected'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_error IS NULL OR btrim(p_error) = '' THEN
    -- Success: the fulfillment pipeline took over (or was already complete).
    UPDATE rf_coin_fulfillment_handoffs
      SET status = 'DONE', lease_until = NULL, lease_token = NULL, last_error = NULL, updated_at = now()
      WHERE id = p_id;
    RETURN QUERY SELECT 'DONE'::text, NULL::timestamptz; RETURN;
  END IF;

  -- Bounded retry with linear backoff; DEAD_LETTER after max_attempts.
  IF v_row.attempt_count >= v_row.max_attempts THEN
    UPDATE rf_coin_fulfillment_handoffs
      SET status = 'DEAD_LETTER', lease_until = NULL, lease_token = NULL,
          last_error = left(btrim(p_error), 1000), updated_at = now()
      WHERE id = p_id;
    RETURN QUERY SELECT 'DEAD_LETTER'::text, NULL::timestamptz; RETURN;
  END IF;

  v_next := clock_timestamp() + make_interval(secs => LEAST(900, 60 * v_row.attempt_count));
  UPDATE rf_coin_fulfillment_handoffs
    SET status = 'PENDING', lease_until = NULL, lease_token = NULL,
        last_error = left(btrim(p_error), 1000), next_attempt_at = v_next, updated_at = now()
    WHERE id = p_id;
  RETURN QUERY SELECT 'PENDING'::text, v_next;
END;
$$;


-- ============ EXECUTE GRANT CORRECTIONS ============
-- Platform default privileges granted EXECUTE to anon/authenticated on all
-- new functions; the original migration only revoked PUBLIC. Remove the
-- unintended direct grants now, function by function (no default-privilege
-- changes, so unrelated application RPCs are untouched).

-- Internal helpers: no direct browser access (called via SECURITY DEFINER paths).
REVOKE ALL ON FUNCTION public.rf_coin_get_settings() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_assert_super_admin() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_get_or_create_wallet(uuid) FROM anon, authenticated;

-- Customer RPCs: authenticated only (identity checked against auth.uid() inside).
REVOKE ALL ON FUNCTION public.rf_coin_create_topup(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rf_coin_settle_order_payment_and_enqueue(uuid, uuid) FROM anon;

-- Admin RPCs: authenticated grant stays; anon revoked. Each function still
-- enforces SUPER_ADMIN internally via rf_coin_assert_super_admin().
REVOKE ALL ON FUNCTION public.rf_coin_request_adjustment(uuid, text, integer, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rf_coin_decide_adjustment(uuid, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer) FROM anon;

-- Webhook settlement/status + order release reversal: service_role only.
REVOKE ALL ON FUNCTION public.rf_coin_credit_paid_topup(uuid, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_mark_topup_status(uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_release_order_payment(uuid, text) FROM anon, authenticated;

-- Fulfillment handoff queue: service_role only.
REVOKE ALL ON FUNCTION public.rf_coin_enqueue_fulfillment(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_claim_fulfillment_handoffs(integer, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_ack_fulfillment_handoff(uuid, uuid, text) FROM anon, authenticated;

-- Re-assert the intended grants (idempotent; no privilege expansion).
GRANT EXECUTE ON FUNCTION public.rf_coin_create_topup(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_settle_order_payment_and_enqueue(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_request_adjustment(uuid, text, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_decide_adjustment(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rf_coin_credit_paid_topup(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_coin_mark_topup_status(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_coin_release_order_payment(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_coin_enqueue_fulfillment(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_coin_claim_fulfillment_handoffs(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_coin_ack_fulfillment_handoff(uuid, uuid, text) TO service_role;

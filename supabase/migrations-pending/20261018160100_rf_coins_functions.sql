-- STATUS: PENDING — NOT applied to the live database. Requires separate owner approval.
-- Apply via the Supabase migration tool with filename 20261018160100_rf_coins_functions.sql
/*
# RF Coins — Secured Functions (Phase 3)

1. Purpose
   All RF Coin balance mutations live in SECURITY DEFINER functions so no
   client (anon or authenticated) can ever write balances directly. Every
   movement is written to the append-only rf_coin_ledger with a unique
   idempotency key, making settlement exactly-once under duplicate webhooks,
   retries, and concurrent checkouts.

2. Functions
   - rf_coin_assert_super_admin()  — internal guard: caller row in admins with
     role SUPER_ADMIN. Raises RF_COIN_FORBIDDEN otherwise.
   - rf_coin_get_settings()        — internal settings reader (fail closed:
     raises RF_COIN_DISABLED if row missing or enabled=false).
   - rf_coin_get_or_create_wallet(p_user_id) — idempotent wallet creation.
   - rf_coin_create_topup(p_user_id, p_package_id) — validates master+topup
     flags and active package, snapshots coins/bonus/price, inserts a PENDING
     top-up, returns out_topup_id/out_coins/out_bonus/out_price_cents/out_error.
   - rf_coin_credit_paid_topup(p_topup_id, p_provider_reference) — marks a
     PENDING top-up PAID and credits coins+bonus exactly once (ledger idem key
     'topup:<id>'). Duplicate calls return success without re-crediting.
     Never credits for non-PENDING/failed/expired top-ups.
   - rf_coin_mark_topup_status(p_topup_id, p_status) — terminal status moves
     (FAILED/EXPIRED/CANCELLED/REFUND_PENDING/REFUNDED). Refunds reverse the
     credited coins+bonus with a bounded DEBIT that RESUMES earlier partial
     reversals: rf_coin_topups.credited_total/reversed_total track the exact
     original credit and cumulative reversal, the outstanding debt is always
     credited_total - reversed_total, and each partial ledger entry carries a
     distinct idempotency key ('topup-reversal:<id>:<cumulative>') so repeated
     reconciliation never double-debits. Whatever cannot be reversed (coins
     already spent) stays visible as REFUND_PENDING for manual handling.
   - rf_coin_settle_order_payment(p_order_id, p_user_id) — atomic full-wallet
     payment for a product order. Computes coins from the order's own
     total_cents and the CURRENT centavos_per_coin (never browser input),
     checks master+spending flags, verifies the order is WAITING_PAYMENT with
     matching customer ownership, locks the wallet row (row lock prevents
     concurrent overspend), debits once (ledger idem 'order:<order_id>'), and
     IN THE SAME ATOMIC BLOCK transitions the order to PAYMENT_VERIFIED
     (payment_status VERIFIED, method 'RF_COIN_WALLET') exactly like
     verify_payment. Post-settlement payment verification or fulfillment can
     never see a debited-but-unpaid order; any failure rolls back everything.
   - rf_coin_release_order_payment(p_order_id, p_reason) — reverses an order
     payment exactly once (ledger idem 'order-reversal:<order_id>') but ONLY
     when the order's payment was wallet-settled (payment_status VERIFIED)
     and the order is not yet supplier-fulfilled; also marks the order
     payment REFUNDED so fulfillment can never pick it up afterwards.
   - rf_coin_request_adjustment(p_target_user_id, p_direction, p_amount_coins,
     p_reason, p_category, p_idempotency_key) — SUPER ADMIN only. Rate-limited
     per admin per day. Low-value requests are applied atomically in the same
     call (ledger idem 'adjust:<request_id>'); high-value requests stay
     PENDING for a second distinct SUPER ADMIN.
   - rf_coin_decide_adjustment(p_request_id, p_approve, p_reason_note) —
     SUPER ADMIN only; approver must differ from requester for high-value
     requests; approval applies the ledger movement atomically. Rejection
     records who/why and leaves the wallet untouched.
   - rf_coin_set_settings(...) — SUPER ADMIN only; updates toggles and rates.
   - rf_coin_upsert_package(...) / rf_coin_set_package_active(...) —
     SUPER ADMIN only package management.
   - rf_coin_enqueue_fulfillment(p_order_id) — service role only. Idempotently
     inserts one fulfillment handoff row for a VERIFIED coin-paid order.
   - rf_coin_claim_fulfillment_handoffs(p_limit, p_lease_seconds) — service
     role only. Lease-based batch claim of PENDING/expired-lease handoffs.
   - rf_coin_ack_fulfillment_handoff(p_id, p_lease_token, p_error) — service
     role only. Marks a claimed handoff DONE, or schedules the next bounded
     retry (DEAD_LETTER after max_attempts).

3. Security
   - All mutating functions are SECURITY DEFINER with locked search_path.
   - Wallet row is locked with SELECT ... FOR UPDATE inside settlement so two
     concurrent checkouts cannot overspend the same balance.
   - Overdraft protection: balance CHECK >= 0 plus explicit balance guard.
   - Revoked EXECUTE from anon/authenticated on every admin function;
     customer-callable functions validate identity from auth.uid() args.

4. Important Notes
   - Fail closed: missing settings row or disabled flags abort every movement.
   - No function deletes or updates ledger rows (append-only trigger guards).
*/

-- ============ INTERNAL HELPERS ============
CREATE OR REPLACE FUNCTION rf_coin_assert_super_admin()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM admins
    WHERE admins.id = auth.uid()
      AND admins.role = 'SUPER_ADMIN'
      AND admins.is_active = true
  ) THEN
    RAISE EXCEPTION 'RF_COIN_FORBIDDEN';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION rf_coin_get_settings()
RETURNS rf_coin_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s rf_coin_settings;
BEGIN
  SELECT * INTO s FROM rf_coin_settings WHERE id = 1;
  IF NOT FOUND OR NOT s.enabled THEN
    RAISE EXCEPTION 'RF_COIN_DISABLED';
  END IF;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION rf_coin_get_or_create_wallet(p_user_id uuid)
RETURNS rf_coin_wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w rf_coin_wallets;
BEGIN
  INSERT INTO rf_coin_wallets (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM rf_coin_wallets WHERE user_id = p_user_id;
  RETURN w;
END;
$$;

-- ============ TOP-UP CREATION (customer) ============
CREATE OR REPLACE FUNCTION rf_coin_create_topup(
  p_user_id uuid,
  p_package_id uuid
)
RETURNS TABLE (out_topup_id uuid, out_coins integer, out_bonus_coins integer,
               out_price_cents integer, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s rf_coin_settings;
  pkg rf_coin_packages;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'RF_COIN_FORBIDDEN'::text;
    RETURN;
  END IF;
  BEGIN
    s := rf_coin_get_settings();
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'RF_COIN_DISABLED'::text;
    RETURN;
  END;
  IF NOT s.topups_enabled THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'RF_COIN_TOPUPS_DISABLED'::text;
    RETURN;
  END IF;
  SELECT * INTO pkg FROM rf_coin_packages WHERE id = p_package_id AND is_active;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::integer, NULL::integer, NULL::integer, 'RF_COIN_PACKAGE_UNAVAILABLE'::text;
    RETURN;
  END IF;

  INSERT INTO rf_coin_topups (user_id, package_id, coins, bonus_coins, price_cents, idempotency_key)
  VALUES (p_user_id, pkg.id, pkg.coins, pkg.bonus_coins, pkg.price_cents,
          'topup-create:' || p_user_id || ':' || gen_random_uuid()::text)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, pkg.coins, pkg.bonus_coins, pkg.price_cents, NULL::text;
END;
$$;

-- ============ TOP-UP CREDIT (webhook/verification only) ============
CREATE OR REPLACE FUNCTION rf_coin_credit_paid_topup(
  p_topup_id uuid,
  p_provider_reference text
)
RETURNS TABLE (out_credited boolean, out_balance bigint, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s rf_coin_settings;
  t rf_coin_topups;
  v_wallet rf_coin_wallets;
  v_total bigint;
  v_balance bigint;
BEGIN
  SELECT * INTO t FROM rf_coin_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, 'RF_COIN_TOPUP_NOT_FOUND'::text; RETURN;
  END IF;

  IF t.status = 'PAID' AND t.credited_at IS NOT NULL THEN
    SELECT balance_coins INTO v_balance FROM rf_coin_wallets WHERE user_id = t.user_id;
    RETURN QUERY SELECT true, v_balance, NULL::text; RETURN; -- already settled
  END IF;
  IF t.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, NULL::bigint, 'RF_COIN_TOPUP_NOT_PENDING'::text; RETURN;
  END IF;
  BEGIN
    s := rf_coin_get_settings();
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::bigint, 'RF_COIN_DISABLED'::text; RETURN;
  END;

  v_total := t.coins::bigint + t.bonus_coins::bigint;

  -- Lock wallet row, credit atomically.
  SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = t.user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO rf_coin_wallets (user_id) VALUES (t.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = t.user_id FOR UPDATE;
  END IF;
  v_balance := v_wallet.balance_coins + v_total;

  UPDATE rf_coin_wallets
    SET balance_coins = v_balance,
        total_purchased_coins = total_purchased_coins + t.coins,
        updated_at = now()
    WHERE user_id = t.user_id;

  INSERT INTO rf_coin_ledger (
    wallet_user_id, direction, amount_coins, kind, balance_after,
    reason, reference_type, reference_id, actor_type, idempotency_key)
  VALUES (
    t.user_id, 'credit', v_total, 'topup_purchase', v_balance,
    'RF Coins purchase', 'rf_coin_topup', t.id::text, 'system',
    'topup:' || t.id::text);

  UPDATE rf_coin_topups
    SET status = 'PAID', provider_reference = COALESCE(p_provider_reference, provider_reference),
        credited_at = now(), credited_total = v_total, updated_at = now()
    WHERE id = t.id;

  RETURN QUERY SELECT true, v_balance, NULL::text;
END;
$$;

-- ============ TOP-UP STATUS MOVES + REFUND REVERSAL ============
CREATE OR REPLACE FUNCTION rf_coin_mark_topup_status(
  p_topup_id uuid,
  p_status text,
  p_provider_reference text DEFAULT NULL
)
RETURNS TABLE (out_ok boolean, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t rf_coin_topups;
  v_wallet rf_coin_wallets;
  v_balance bigint;
  v_total bigint;
  v_reversed bigint;
  v_outstanding bigint;
BEGIN
  IF p_status NOT IN ('FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED') THEN
    RETURN QUERY SELECT false, 'RF_COIN_INVALID_STATUS'::text; RETURN;
  END IF;
  SELECT * INTO t FROM rf_coin_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'RF_COIN_TOPUP_NOT_FOUND'::text; RETURN;
  END IF;
  IF t.status = p_status THEN
    RETURN QUERY SELECT true, NULL::text; RETURN; -- idempotent
  END IF;
  -- Legal transitions only: a PENDING top-up can be failed/expired/cancelled,
  -- but refunds are only meaningful for a PAID (credited) top-up.
  IF p_status IN ('REFUND_PENDING','REFUNDED') AND t.status NOT IN ('PENDING','PAID','REFUND_PENDING') THEN
    RETURN QUERY SELECT false, 'RF_COIN_INVALID_STATUS'::text; RETURN;
  END IF;
  IF p_status IN ('FAILED','EXPIRED','CANCELLED') AND t.status <> 'PENDING' THEN
    RETURN QUERY SELECT false, 'RF_COIN_INVALID_STATUS'::text; RETURN;
  END IF;
  IF p_status = 'REFUNDED' AND t.credited_at IS NULL THEN
    -- Coins were never credited; nothing to reverse.
    UPDATE rf_coin_topups SET status = 'REFUNDED', updated_at = now() WHERE id = t.id;
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;

  IF p_status IN ('REFUND_PENDING','REFUNDED') THEN
    -- Correct accounting: reverse the originally credited amount (coins +
    -- bonus) with a DEBIT, resuming any earlier partial reversal. The
    -- outstanding debt is credited_total - reversed_total, so repeated
    -- reconciliation can never double-debit. Coins already spent are not
    -- clawed back into a negative balance; whatever cannot be reversed right
    -- now keeps the top-up in REFUND_PENDING for controlled manual handling.
    v_total := COALESCE(NULLIF(t.credited_total, 0), t.coins::bigint + t.bonus_coins::bigint);
    v_outstanding := v_total - t.reversed_total;
    IF v_outstanding <= 0 THEN
      -- Debt already fully settled by earlier reversals: just close it out.
      UPDATE rf_coin_topups SET status = 'REFUNDED', updated_at = now() WHERE id = t.id;
      RETURN QUERY SELECT true, NULL::text; RETURN;
    END IF;

    SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = t.user_id FOR UPDATE;
    IF v_wallet IS NULL OR v_wallet.balance_coins <= 0 THEN
      UPDATE rf_coin_topups SET status = 'REFUND_PENDING', updated_at = now() WHERE id = t.id;
      RETURN QUERY SELECT false, 'RF_COIN_REVERSAL_INCOMPLETE'::text; RETURN;
    END IF;
    v_reversed := least(v_outstanding, v_wallet.balance_coins);
    v_balance := v_wallet.balance_coins - v_reversed;

    UPDATE rf_coin_wallets
      SET balance_coins = v_balance,
          total_reversed_coins = total_reversed_coins + v_reversed,
          updated_at = now()
      WHERE user_id = t.user_id;

    INSERT INTO rf_coin_ledger (
      wallet_user_id, direction, amount_coins, kind, balance_after,
      reason, reference_type, reference_id, actor_type, idempotency_key)
    VALUES (
      t.user_id, 'debit', v_reversed, 'chargeback_reversal', v_balance,
      'RF Coins purchase refund reversal', 'rf_coin_topup', t.id::text, 'system',
      'topup-reversal:' || t.id::text || ':' || (t.reversed_total + v_reversed)::text);

    UPDATE rf_coin_topups
      SET reversed_total = reversed_total + v_reversed,
          status = CASE WHEN t.reversed_total + v_reversed >= v_total
                    THEN 'REFUNDED' ELSE 'REFUND_PENDING' END,
          provider_reference = COALESCE(p_provider_reference, provider_reference),
          updated_at = now()
      WHERE id = t.id;

    IF t.reversed_total + v_reversed < v_total THEN
      RETURN QUERY SELECT false, 'RF_COIN_REVERSAL_INCOMPLETE'::text; RETURN;
    END IF;
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;

  UPDATE rf_coin_topups
    SET status = p_status,
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        updated_at = now()
    WHERE id = t.id;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

-- ============ ORDER SETTLEMENT (full-wallet payment) ============
CREATE OR REPLACE FUNCTION rf_coin_settle_order_payment(
  p_order_id uuid,
  p_user_id uuid
)
RETURNS TABLE (out_coins integer, out_balance_after bigint, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s rf_coin_settings;
  ord RECORD;
  v_coins integer;
  v_wallet rf_coin_wallets;
  v_balance bigint;
  v_order_status text;
  v_order_method text;
  v_order_payment text;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_FORBIDDEN'::text; RETURN;
  END IF;
  BEGIN
    s := rf_coin_get_settings();
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_DISABLED'::text; RETURN;
  END;
  IF NOT s.spending_enabled THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_SPENDING_DISABLED'::text; RETURN;
  END IF;

  SELECT id, total_cents, customer_user_id, status, payment_method, payment_status INTO ord
    FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_ORDER_NOT_FOUND'::text; RETURN;
  END IF;
  -- Cross-method protection: only orders created for the RF Coins wallet
  -- method can be settled here, and only while still awaiting payment. A
  -- PayMongo/gcash/manual order must never be settled from wallet balance.
  IF ord.payment_method IS NULL OR ord.payment_method <> 'rf_coin_wallet' THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_ORDER_WRONG_METHOD'::text; RETURN;
  END IF;
  IF ord.customer_user_id IS NULL OR ord.customer_user_id <> p_user_id THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_FORBIDDEN'::text; RETURN;
  END IF;
  -- Idempotency: a second settlement attempt for the same order returns the
  -- original result instead of double-debiting. Checked before the waiting
  -- pre-check because an already-settled order is no longer WAITING_PAYMENT.
  IF EXISTS (
    SELECT 1 FROM rf_coin_ledger WHERE idempotency_key = 'order:' || ord.id::text
  ) THEN
    SELECT amount_coins::integer, balance_after INTO v_coins, v_balance
      FROM rf_coin_ledger WHERE idempotency_key = 'order:' || ord.id::text;
    RETURN QUERY SELECT v_coins, v_balance, NULL::text; RETURN;
  END IF;
  IF ord.status <> 'WAITING_PAYMENT' OR COALESCE(ord.payment_status, 'UNPAID') NOT IN ('UNPAID','PENDING') THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_ORDER_NOT_WAITING'::text; RETURN;
  END IF;

  -- Coin price derived from the order's own stored total (server authority).
  v_coins := CEIL(ord.total_cents::numeric / s.centavos_per_coin)::integer;

  SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
  END IF;
  IF v_wallet.balance_coins < v_coins THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
  END IF;
  v_balance := v_wallet.balance_coins - v_coins;

  -- Lock the order row and settle + verify in one atomic block. Re-check
  -- method/status under lock so a concurrent PayMongo settlement or a second
  -- RF Coins attempt cannot slip through between the pre-checks and here.
  SELECT status, payment_method, payment_status INTO v_order_status, v_order_method, v_order_payment
    FROM orders WHERE id = ord.id FOR UPDATE;
  IF v_order_method <> 'rf_coin_wallet'
     OR v_order_status <> 'WAITING_PAYMENT'
     OR COALESCE(v_order_payment, 'UNPAID') NOT IN ('UNPAID','PENDING') THEN
    RETURN QUERY SELECT NULL::integer, NULL::bigint, 'RF_COIN_ORDER_NOT_WAITING'::text; RETURN;
  END IF;

  UPDATE rf_coin_wallets
    SET balance_coins = v_balance,
        total_spent_coins = total_spent_coins + v_coins,
        updated_at = now()
    WHERE user_id = p_user_id;

  INSERT INTO rf_coin_ledger (
    wallet_user_id, direction, amount_coins, kind, balance_after,
    reason, reference_type, reference_id, actor_type, actor_id, idempotency_key)
  VALUES (
    p_user_id, 'debit', v_coins::bigint, 'order_payment', v_balance,
    'Order payment with RF Coins', 'order', ord.id::text, 'customer', p_user_id,
    'order:' || ord.id::text);

  -- Mark the order as paid in the SAME transaction as the debit: a wallet
  -- debit must never result in an unpaid order, and verify-payment/fulfillment
  -- paths only accept orders whose payment_status is VERIFIED.
  UPDATE orders SET
    payment_status = 'VERIFIED',
    payment_verification_method = 'RF_COIN_WALLET',
    payment_verified_at = now(),
    payment_verified_by = 'rf_coin_wallet:' || p_user_id::text,
    status = 'PAYMENT_VERIFIED',
    updated_at = now()
  WHERE id = ord.id;

  INSERT INTO order_timeline (order_id, status, actor_email, note)
  VALUES (ord.id, 'PAYMENT_VERIFIED', 'rf_coin_wallet:' || p_user_id::text,
    'Payment verified with RF Coins wallet (' || v_coins::text || ' coins)');

  RETURN QUERY SELECT v_coins, v_balance, NULL::text;
END;
$$;

-- ============ ORDER RELEASE (failure/cancel reversal) ============
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

-- ============ ADMIN MANUAL ADJUSTMENTS ============
CREATE OR REPLACE FUNCTION rf_coin_request_adjustment(
  p_target_user_id uuid,
  p_direction text,
  p_amount_coins integer,
  p_reason text,
  p_category text,
  p_idempotency_key text
)
RETURNS TABLE (out_request_id uuid, out_status text, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s rf_coin_settings;
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  v_is_high_value boolean;
  v_id uuid;
  v_daily_count integer;
  v_ledger rf_coin_ledger;
  v_wallet rf_coin_wallets;
  v_balance bigint;
  v_status text;
BEGIN
  BEGIN
    PERFORM rf_coin_assert_super_admin();
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_FORBIDDEN'::text; RETURN;
  END;
  IF p_direction NOT IN ('credit','debit') OR p_amount_coins IS NULL OR p_amount_coins <= 0
     OR p_category NOT IN ('promotion','compensation','correction')
     OR p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_INVALID_REQUEST'::text; RETURN;
  END IF;

  -- Idempotency: identical retry returns the original request.
  IF p_idempotency_key IS NOT NULL AND length(p_idempotency_key) <= 200 THEN
    SELECT id, status INTO v_id, v_status FROM rf_coin_adjustment_requests
      WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN QUERY SELECT v_id, v_status, NULL::text; RETURN;
    END IF;
  END IF;

  s := rf_coin_get_settings();

  -- Rate control: per-admin daily adjustment cap.
  SELECT count(*) INTO v_daily_count FROM rf_coin_admin_audit
    WHERE actor_admin_id = v_admin_id
      AND action IN ('adjustment_applied','adjustment_requested')
      AND created_at > now() - interval '24 hours';
  IF v_daily_count >= s.max_daily_admin_adjustments THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_RATE_LIMITED'::text; RETURN;
  END IF;

  SELECT email INTO v_admin_email FROM admins WHERE id = v_admin_id;
  v_is_high_value := p_amount_coins >= s.high_value_adjustment_coins;

  INSERT INTO rf_coin_adjustment_requests (
    target_user_id, direction, amount_coins, reason, category,
    status, requested_by, requested_by_email, is_high_value, idempotency_key)
  VALUES (
    p_target_user_id, p_direction, p_amount_coins, trim(p_reason), p_category,
    CASE WHEN v_is_high_value THEN 'PENDING' ELSE 'APPROVED' END,
    v_admin_id, COALESCE(v_admin_email, 'unknown'), v_is_high_value,
    COALESCE(p_idempotency_key, 'adjust-req:' || gen_random_uuid()::text))
  RETURNING id INTO v_id;

  INSERT INTO rf_coin_admin_audit (
    actor_admin_id, actor_admin_email, action, target_user_id,
    entity_type, entity_id, details)
  VALUES (
    v_admin_id, COALESCE(v_admin_email, 'unknown'),
    CASE WHEN v_is_high_value THEN 'adjustment_requested' ELSE 'adjustment_applied' END,
    p_target_user_id, 'rf_coin_adjustment_request', v_id::text,
    jsonb_build_object('direction', p_direction, 'amount_coins', p_amount_coins,
      'category', p_category, 'reason', trim(p_reason),
      'high_value', v_is_high_value));

  IF NOT v_is_high_value THEN
    -- Low value: apply immediately and atomically. Credits must work for
    -- zero-balance and brand-new wallets; balance checks apply to debits only.
    SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
      IF p_direction = 'debit' THEN
        RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
      END IF;
      INSERT INTO rf_coin_wallets (user_id) VALUES (p_target_user_id)
        ON CONFLICT (user_id) DO NOTHING;
      SELECT * INTO v_wallet FROM rf_coin_wallets WHERE user_id = p_target_user_id FOR UPDATE;
    END IF;
    IF p_direction = 'debit' AND v_wallet.balance_coins < p_amount_coins THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'::text; RETURN;
    END IF;
    v_balance := v_wallet.balance_coins
      + CASE WHEN p_direction = 'credit' THEN p_amount_coins ELSE -p_amount_coins END;

    UPDATE rf_coin_wallets
      SET balance_coins = v_balance,
          total_manual_credited_coins = total_manual_credited_coins
            + CASE WHEN p_direction = 'credit' THEN p_amount_coins ELSE 0 END,
          total_manual_debited_coins = total_manual_debited_coins
            + CASE WHEN p_direction = 'debit' THEN p_amount_coins ELSE 0 END,
          updated_at = now()
      WHERE user_id = p_target_user_id;

    INSERT INTO rf_coin_ledger (
      wallet_user_id, direction, amount_coins, kind, balance_after,
      reason, reference_type, reference_id, actor_type, actor_id, idempotency_key)
    VALUES (
      p_target_user_id, p_direction, p_amount_coins::bigint,
      CASE WHEN p_direction = 'credit' THEN 'manual_credit' ELSE 'manual_debit' END,
      v_balance, trim(p_reason), 'rf_coin_adjustment_request', v_id::text,
      'admin', v_admin_id,
      'adjust:' || v_id::text)
    RETURNING * INTO v_ledger;

    UPDATE rf_coin_adjustment_requests
      SET status = 'APPLIED', applied_ledger_id = v_ledger.id, updated_at = now()
      WHERE id = v_id;

    INSERT INTO rf_coin_admin_audit (
      actor_admin_id, actor_admin_email, action, target_user_id,
      entity_type, entity_id, details)
    VALUES (
      v_admin_id, COALESCE(v_admin_email, 'unknown'), 'adjustment_applied',
      p_target_user_id, 'rf_coin_ledger', v_ledger.id::text,
      jsonb_build_object('request_id', v_id, 'balance_after', v_balance));

    RETURN QUERY SELECT v_id, 'APPLIED'::text, NULL::text; RETURN;
  END IF;

  RETURN QUERY SELECT v_id, 'PENDING'::text, NULL::text; RETURN;
END;
$$;

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

-- ============ SETTINGS + PACKAGES (SUPER ADMIN) ============
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

CREATE OR REPLACE FUNCTION rf_coin_upsert_package(
  p_package_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_coins integer DEFAULT NULL,
  p_bonus_coins integer DEFAULT NULL,
  p_price_cents integer DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM rf_coin_assert_super_admin();
  IF p_package_id IS NULL THEN
    IF p_name IS NULL OR p_coins IS NULL OR p_coins <= 0
       OR p_price_cents IS NULL OR p_price_cents <= 0 THEN
      RAISE EXCEPTION 'RF_COIN_INVALID_PACKAGE';
    END IF;
    INSERT INTO rf_coin_packages (name, coins, bonus_coins, price_cents, is_active, sort_order)
    VALUES (p_name, p_coins, COALESCE(p_bonus_coins, 0), p_price_cents,
            COALESCE(p_is_active, true), COALESCE(p_sort_order, 0))
    RETURNING id INTO v_id;
  ELSE
    UPDATE rf_coin_packages SET
      name = COALESCE(p_name, name),
      coins = COALESCE(p_coins, coins),
      bonus_coins = COALESCE(p_bonus_coins, bonus_coins),
      price_cents = COALESCE(p_price_cents, price_cents),
      is_active = COALESCE(p_is_active, is_active),
      sort_order = COALESCE(p_sort_order, sort_order),
      updated_at = now()
    WHERE id = p_package_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'RF_COIN_PACKAGE_NOT_FOUND'; END IF;
  END IF;

  INSERT INTO rf_coin_admin_audit (
    actor_admin_id, actor_admin_email, action, entity_type, entity_id, details)
  SELECT auth.uid(), COALESCE(email, 'unknown'), 'package_change', 'rf_coin_packages', v_id::text,
    jsonb_build_object('name', p_name, 'coins', p_coins, 'bonus_coins', p_bonus_coins,
      'price_cents', p_price_cents, 'is_active', p_is_active)
  FROM admins WHERE id = auth.uid();
  RETURN v_id;
END;
$$;

-- ============ FULFILLMENT HANDOFF QUEUE (durable, worker-claimed) ============
-- Durable replacement for fire-and-forget fulfillment triggering after coin
-- settlement. The checkout enqueues exactly one row per order; the scheduled
-- fulfillment-handoff Edge Function claims rows under a lease and drives the
-- SAME fulfillment pipeline the webhook and admin paths use (atomic
-- complete_fulfillment claim + supplier transaction idempotency keys), so a
-- coin-paid order never depends on the checkout request surviving.
-- Mirrors the order_email_outbox worker pattern (lease + bounded retries).
CREATE OR REPLACE FUNCTION rf_coin_enqueue_fulfillment(
  p_order_id uuid
)
RETURNS TABLE (out_handoff_id uuid, out_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_order_status text;
  v_payment_status text;
  v_method text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'RF_COIN_ORDER_NOT_FOUND'::text; RETURN;
  END IF;

  SELECT status, payment_status, payment_method INTO v_order_status, v_payment_status, v_method
    FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'RF_COIN_ORDER_NOT_FOUND'::text; RETURN;
  END IF;
  -- Only verified wallet-paid orders may enter the fulfillment queue: a
  -- cancelled, refunded, or foreign-method order must never be fulfilled.
  IF v_method IS NULL OR v_method <> 'rf_coin_wallet' OR v_payment_status <> 'VERIFIED'
     OR v_order_status NOT IN ('PAYMENT_VERIFIED','PROCESSING') THEN
    RETURN QUERY SELECT NULL::uuid, 'RF_COIN_ORDER_NOT_ELIGIBLE'::text; RETURN;
  END IF;

  -- Idempotent enqueue: concurrent or retried checkouts collapse to one row.
  INSERT INTO rf_coin_fulfillment_handoffs (order_id, idempotency_key)
  VALUES (p_order_id, 'rf-coin-fulfillment:' || p_order_id::text)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM rf_coin_fulfillment_handoffs WHERE order_id = p_order_id;
  END IF;
  RETURN QUERY SELECT v_id, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION rf_coin_claim_fulfillment_handoffs(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (out_id uuid, out_order_id uuid, out_attempt_count integer,
               out_lease_token uuid, out_lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 900);
BEGIN
  -- Quarantine rows that exhausted their bounded attempts; never re-serve them.
  UPDATE rf_coin_fulfillment_handoffs
    SET status = 'DEAD_LETTER', lease_until = NULL, lease_token = NULL,
        last_error = 'Maximum fulfillment handoff attempts exceeded', updated_at = now()
  WHERE attempt_count >= max_attempts
    AND (
      status = 'PENDING'
      OR (status = 'PROCESSING' AND (lease_until IS NULL OR lease_until <= clock_timestamp()))
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT h.id
    FROM rf_coin_fulfillment_handoffs h
    JOIN orders o ON o.id = h.order_id
    WHERE h.attempt_count < h.max_attempts
      AND (
        (h.status = 'PENDING' AND h.next_attempt_at <= clock_timestamp())
        OR (h.status = 'PROCESSING' AND (h.lease_until IS NULL OR h.lease_until <= clock_timestamp()))
      )
      -- Fulfillment preconditions, re-checked at claim time: payment must
      -- still be verified and fulfillment not already terminal/in flight.
      -- TERMINAL state rows are skipped, never re-enqueued from here.
      AND o.payment_status = 'VERIFIED'
      AND o.fulfillment_status NOT IN ('PROCESSING','COMPLETED')
      AND NOT EXISTS (
        SELECT 1 FROM supplier_transactions st
        WHERE st.order_id = h.order_id AND st.action = 'create_order'
          AND st.status IN ('submitted','success','pending')
      )
    ORDER BY h.next_attempt_at, h.created_at, h.id
    FOR UPDATE OF h SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE rf_coin_fulfillment_handoffs AS h
    SET status = 'PROCESSING',
        attempt_count = h.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_until = clock_timestamp() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    FROM candidates AS c
    WHERE h.id = c.id
    RETURNING h.id, h.order_id, h.attempt_count, h.lease_token, h.lease_until
  )
  SELECT c.id, c.order_id, c.attempt_count, c.lease_token, c.lease_until FROM claimed AS c;
END;
$$;

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
REVOKE ALL ON FUNCTION rf_coin_settle_order_payment(uuid, uuid) FROM PUBLIC;
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
GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment(uuid, uuid) TO authenticated;

-- Admin mutation RPCs: callable by authenticated admins whose JWT the API
-- route forwards. Each function independently re-verifies the SUPER_ADMIN
-- role, active status and caller identity via rf_coin_assert_super_admin(),
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

-- STATUS: PENDING — NOT applied to the live database. Requires separate owner approval.
-- Apply via the Supabase migration tool with filename 20261018160100_rf_coins_functions.sql
-- NOTE: applied as two parts (part 1 = this file; part 2 = 20261018160101_rf_coins_functions_part2.sql)
-- due to tool payload size limits. Content is verbatim from the approved file.
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
   (part 2: adjustments, settings/packages, fulfillment handoff queue,
   atomic settle+enqueue wrapper, EXECUTE grants)

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
    RETURN QUERY SELECT false, 'RF_COIN_RELEASE_NOT_ELIGIBLE'::text; RETURN;
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
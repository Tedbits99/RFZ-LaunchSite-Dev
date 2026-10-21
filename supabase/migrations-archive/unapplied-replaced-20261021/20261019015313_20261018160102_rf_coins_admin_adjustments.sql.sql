-- Part 2a of 20261018160100_rf_coins_functions.sql (admin adjustments).
-- Content verbatim from the approved pending file.
/*
# RF Coins — Admin manual adjustments (part 2a)

- rf_coin_request_adjustment: SUPER ADMIN only, rate-limited per admin per
  day; low-value requests applied atomically, high-value stay PENDING.
- rf_coin_decide_adjustment: SUPER ADMIN only; high-value needs a second
  distinct admin; approval applies the ledger movement atomically.
*/

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
    req.target_user_id, 'rf_coin_ledger', req.id::text,
    jsonb_build_object('request_id', req.id, 'balance_after', v_balance,
      'note', p_note));

  RETURN QUERY SELECT 'APPLIED'::text, NULL::text; RETURN;
END;
$$;
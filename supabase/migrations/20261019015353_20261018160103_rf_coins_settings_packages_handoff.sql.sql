-- Part 2b of 20261018160100_rf_coins_functions.sql (settings, packages,
-- fulfillment handoff queue). Content verbatim from the approved pending file.
/*
# RF Coins — Settings, packages, fulfillment handoff queue (part 2b)

- rf_coin_set_settings / rf_coin_upsert_package: SUPER ADMIN only.
- rf_coin_enqueue/claim/ack fulfillment handoffs: durable lease-based queue,
  service-role only; re-checks payment/fulfillment preconditions at claim.
*/

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
    centavos_per_coin = COALESCE(p_centavos_per_coin, v_coin_settings, v_old.centavos_per_coin),
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
          last_error = Ieff(btrim(p_error), 1000), updated_at = now()
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
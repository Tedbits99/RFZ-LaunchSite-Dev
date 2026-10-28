-- RF Coins Admin Center: bounded, role-checked reporting surface.
-- STATUS: PENDING. This migration has not been applied to the hosted project.
-- Requires 20261018160000_rf_coins_schema.sql and
-- 20261018160100_rf_coins_functions.sql.

CREATE INDEX IF NOT EXISTS rf_coin_ledger_created_kind_idx
  ON public.rf_coin_ledger (created_at DESC, kind);
CREATE INDEX IF NOT EXISTS rf_coin_ledger_kind_created_idx
  ON public.rf_coin_ledger (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS rf_coin_topups_created_status_idx
  ON public.rf_coin_topups (created_at DESC, status);
CREATE INDEX IF NOT EXISTS rf_coin_topups_pending_created_idx
  ON public.rf_coin_topups (created_at DESC) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION public.rf_coin_admin_center_read(
  p_search text DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25,
  p_wallet_user_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_topup_status text DEFAULT NULL,
  p_wallet_status text DEFAULT 'all',
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  v_search text := nullif(left(btrim(coalesce(p_search, '')), 100), '');
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_wallet_status text := coalesce(p_wallet_status, 'all');
  v_result jsonb;
BEGIN
  PERFORM public.rf_coin_assert_super_admin();

  IF p_topup_status IS NOT NULL AND p_topup_status NOT IN
    ('PENDING','PAID','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED') THEN
    RAISE EXCEPTION 'RF_COIN_INVALID_TOPUP_FILTER';
  END IF;
  IF p_provider IS NOT NULL AND (length(p_provider) > 60 OR p_provider !~ '^[a-zA-Z0-9_-]+$') THEN
    RAISE EXCEPTION 'RF_COIN_INVALID_PROVIDER_FILTER';
  END IF;
  IF v_wallet_status NOT IN ('all','zero','nonzero') THEN
    RAISE EXCEPTION 'RF_COIN_INVALID_WALLET_FILTER';
  END IF;
  IF v_from >= v_to OR v_to - v_from > interval '90 days' THEN
    RAISE EXCEPTION 'RF_COIN_INVALID_REPORT_RANGE';
  END IF;

  WITH exceptions AS (
    SELECT 'topup:' || t.id::text || ':' || issue.category AS alert_key,
      issue.severity, issue.category, 'rf_coin_topup'::text AS entity_type,
      t.id::text AS entity_id, t.user_id AS target_user_id,
      issue.summary, t.created_at AS occurred_at
    FROM public.rf_coin_topups t
    CROSS JOIN LATERAL (VALUES
      (t.status = 'PAID' AND t.credited_at IS NULL, 'critical', 'paid_not_credited', 'Paid top-up has not been credited'),
      (t.credited_at IS NOT NULL AND t.payment_verified_at IS NULL, 'critical', 'credit_without_verified_settlement', 'Credit exists without verified settlement'),
      (t.credited_at IS NOT NULL AND t.status NOT IN ('PAID','REFUND_PENDING','REFUNDED'), 'high', 'credit_status_mismatch', 'Credited top-up has an incompatible status'),
      (t.status = 'PAID' AND t.credited_at IS NOT NULL AND t.credited_total <> t.coins::bigint + t.bonus_coins::bigint, 'high', 'credit_amount_mismatch', 'Credited amount differs from package snapshot'),
      (t.status = 'REFUNDED' AND t.reversed_total < t.credited_total, 'critical', 'refund_reversal_incomplete', 'Refund is recorded but wallet reversal is incomplete'),
      (t.status = 'PAID' AND NOT EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.rf_coin_topup_id = t.id AND pt.action = 'create'), 'high', 'paid_without_payment_session', 'Paid top-up has no linked payment session'),
      (t.status = 'PENDING' AND t.created_at < now() - interval '24 hours', 'medium', 'long_pending_topup', 'Top-up has remained pending for over 24 hours')
    ) AS issue(is_open, severity, category, summary)
    WHERE issue.is_open AND t.created_at >= v_from AND t.created_at < v_to

    UNION ALL
    SELECT 'payment:' || t.id::text || ':' || pt.id::text,
      'high', 'payment_amount_mismatch', 'rf_coin_topup', t.id::text, t.user_id,
      'Payment session amount, currency, or provider reference differs from top-up', t.created_at
    FROM public.rf_coin_topups t
    JOIN public.payment_transactions pt ON pt.rf_coin_topup_id = t.id AND pt.action = 'create'
    WHERE t.status = 'PAID' AND t.created_at >= v_from AND t.created_at < v_to
      AND (pt.amount_cents IS DISTINCT FROM t.price_cents OR upper(pt.currency) IS DISTINCT FROM 'PHP'
        OR pt.provider_reference IS DISTINCT FROM t.provider_reference)

    UNION ALL
    SELECT 'provider-ref:' || md5(t.provider_reference), 'high', 'duplicate_provider_reference',
      'rf_coin_topup', (array_agg(t.id ORDER BY t.id))[1]::text, NULL::uuid,
      'The same provider reference is attached to multiple top-ups', max(t.created_at)
    FROM public.rf_coin_topups t
    WHERE t.provider_reference IS NOT NULL AND t.created_at >= v_from AND t.created_at < v_to
    GROUP BY t.provider_reference HAVING count(*) > 1

    UNION ALL
    SELECT 'duplicate-credit:' || l.reference_id, 'critical', 'duplicate_credit_attempt',
      'rf_coin_topup', l.reference_id, NULL::uuid,
      'More than one top-up credit ledger row exists for this reference', max(l.created_at)
    FROM public.rf_coin_ledger l
    WHERE l.kind = 'topup_purchase' AND l.reference_type = 'rf_coin_topup'
      AND l.created_at >= v_from AND l.created_at < v_to
    GROUP BY l.reference_id HAVING count(*) > 1

    UNION ALL
    SELECT 'duplicate-session:' || pt.rf_coin_topup_id::text, 'high', 'duplicate_payment_sessions',
      'rf_coin_topup', pt.rf_coin_topup_id::text, NULL::uuid,
      'More than one payment creation session exists for this top-up', max(pt.created_at)
    FROM public.payment_transactions pt
    WHERE pt.rf_coin_topup_id IS NOT NULL AND pt.action = 'create'
      AND pt.created_at >= v_from AND pt.created_at < v_to
    GROUP BY pt.rf_coin_topup_id HAVING count(*) > 1

    UNION ALL
    SELECT 'ledger-wallet:' || w.user_id::text, 'critical', 'wallet_ledger_mismatch',
      'rf_coin_wallet', w.user_id::text, w.user_id,
      'Stored wallet balance differs from the immutable ledger total', w.updated_at
    FROM public.rf_coin_wallets w
    LEFT JOIN (SELECT l.wallet_user_id,
        sum(CASE WHEN l.direction = 'credit' THEN l.amount_coins ELSE -l.amount_coins END) AS ledger_balance
      FROM public.rf_coin_ledger l GROUP BY l.wallet_user_id) totals ON totals.wallet_user_id = w.user_id
    WHERE w.balance_coins <> coalesce(totals.ledger_balance, 0)
      AND w.updated_at >= v_from AND w.updated_at < v_to

    UNION ALL
    SELECT 'adjustment:' || r.id::text, 'high', 'unusual_manual_adjustment',
      'rf_coin_adjustment_request', r.id::text, r.target_user_id,
      'High-value manual adjustment requires review of its immutable audit trail', r.created_at
    FROM public.rf_coin_adjustment_requests r
    WHERE r.is_high_value AND r.created_at >= v_from AND r.created_at < v_to
  )
  SELECT jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'updated_by' FROM public.rf_coin_settings s WHERE s.id = 1),
    'metrics', jsonb_build_object(
      'outstanding', coalesce((SELECT sum(w.balance_coins) FROM public.rf_coin_wallets w), 0)::text,
      'walletCount', (SELECT count(*) FROM public.rf_coin_wallets)::text,
      'purchased', coalesce((SELECT sum(w.total_purchased_coins) FROM public.rf_coin_wallets w), 0)::text,
      'spent', coalesce((SELECT sum(l.amount_coins) FROM public.rf_coin_ledger l WHERE l.kind = 'order_payment'), 0)::text,
      'manualCredited', coalesce((SELECT sum(l.amount_coins) FROM public.rf_coin_ledger l WHERE l.kind = 'manual_credit'), 0)::text,
      'manualDebited', coalesce((SELECT sum(l.amount_coins) FROM public.rf_coin_ledger l WHERE l.kind = 'manual_debit'), 0)::text,
      'reversed', coalesce((SELECT sum(l.amount_coins) FROM public.rf_coin_ledger l WHERE l.kind IN ('order_reversal','chargeback_reversal','rounding_refund')), 0)::text,
      'pendingTopups', (SELECT count(*) FROM public.rf_coin_topups t WHERE t.status = 'PENDING')::text,
      'pendingTopupCents', coalesce((SELECT sum(t.price_cents) FROM public.rf_coin_topups t WHERE t.status = 'PENDING'), 0)::text,
      'failedExpiredTopups', (SELECT count(*) FROM public.rf_coin_topups t WHERE t.status IN ('FAILED','EXPIRED'))::text,
      'pendingAdjustments', (SELECT count(*) FROM public.rf_coin_adjustment_requests r WHERE r.status = 'PENDING')::text,
      'ledgerBalanceDiscrepancies', (SELECT count(*) FROM (
        SELECT w.user_id FROM public.rf_coin_wallets w
        LEFT JOIN (SELECT l.wallet_user_id,
            sum(CASE WHEN l.direction = 'credit' THEN l.amount_coins ELSE -l.amount_coins END) AS ledger_balance
          FROM public.rf_coin_ledger l GROUP BY l.wallet_user_id) totals ON totals.wallet_user_id = w.user_id
        WHERE w.balance_coins <> coalesce(totals.ledger_balance, 0)
      ) mismatches)::text,
      'duplicateProviderReferences', (SELECT count(*) FROM (
        SELECT t.provider_reference FROM public.rf_coin_topups t
        WHERE t.provider_reference IS NOT NULL GROUP BY t.provider_reference HAVING count(*) > 1
      ) duplicate_refs)::text,
      'duplicateCreditAttempts', (SELECT count(*) FROM (
        SELECT l.reference_id FROM public.rf_coin_ledger l
        WHERE l.kind = 'topup_purchase' AND l.reference_type = 'rf_coin_topup'
        GROUP BY l.reference_id HAVING count(*) > 1
      ) duplicate_credits)::text,
      'duplicatePaymentSessions', (SELECT count(*) FROM (
        SELECT pt.rf_coin_topup_id FROM public.payment_transactions pt
        WHERE pt.rf_coin_topup_id IS NOT NULL AND pt.action = 'create'
        GROUP BY pt.rf_coin_topup_id HAVING count(*) > 1
      ) duplicate_sessions)::text,
      'paidTopupsMissingPaymentSession', (SELECT count(*) FROM public.rf_coin_topups t
        WHERE t.status = 'PAID' AND NOT EXISTS (
          SELECT 1 FROM public.payment_transactions pt
          WHERE pt.rf_coin_topup_id = t.id AND pt.action = 'create'
        ))::text,
      'paymentAmountMismatches', (SELECT count(*) FROM public.rf_coin_topups t
        JOIN public.payment_transactions pt ON pt.rf_coin_topup_id = t.id
        WHERE t.status = 'PAID' AND pt.action = 'create'
          AND (pt.amount_cents IS DISTINCT FROM t.price_cents OR upper(pt.currency) IS DISTINCT FROM 'PHP'
            OR pt.provider_reference IS DISTINCT FROM t.provider_reference))::text,
      'unresolvedExceptions', (SELECT count(*) FROM exceptions)::text
    ),
    'wallets', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_wallets w JOIN auth.users u ON u.id = w.user_id
        WHERE (p_wallet_user_id IS NULL OR w.user_id = p_wallet_user_id)
          AND (v_wallet_status = 'all' OR (v_wallet_status = 'zero' AND w.balance_coins = 0)
            OR (v_wallet_status = 'nonzero' AND w.balance_coins > 0))
          AND (v_search IS NULL OR w.user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%')),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT w.user_id, u.email, w.balance_coins::text AS balance_coins,
          w.total_purchased_coins::text AS total_purchased_coins, w.total_spent_coins::text AS total_spent_coins,
          w.total_manual_credited_coins::text AS total_manual_credited_coins,
          w.total_manual_debited_coins::text AS total_manual_debited_coins,
          w.total_reversed_coins::text AS total_reversed_coins,
          w.created_at, w.updated_at
        FROM public.rf_coin_wallets w JOIN auth.users u ON u.id = w.user_id
        WHERE (p_wallet_user_id IS NULL OR w.user_id = p_wallet_user_id)
          AND (v_wallet_status = 'all' OR (v_wallet_status = 'zero' AND w.balance_coins = 0)
            OR (v_wallet_status = 'nonzero' AND w.balance_coins > 0))
          AND (v_search IS NULL OR w.user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%')
        ORDER BY w.updated_at DESC, w.user_id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'topups', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_topups t JOIN auth.users u ON u.id = t.user_id
        WHERE (p_wallet_user_id IS NULL OR t.user_id = p_wallet_user_id)
          AND (p_topup_status IS NULL OR t.status = p_topup_status)
          AND (p_provider IS NULL OR t.provider = p_provider)
          AND t.created_at >= v_from AND t.created_at < v_to
          AND (v_search IS NULL OR t.id::text ILIKE '%' || v_search || '%'
          OR t.user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%'
          OR coalesce(t.provider_reference, '') ILIKE '%' || v_search || '%'
          OR t.provider ILIKE '%' || v_search || '%')),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT t.id, t.user_id, u.email, t.package_id, p.name AS package_name, t.coins, t.bonus_coins, t.price_cents,
          t.provider, t.provider_reference, t.status, t.payment_verified_at, t.credited_at, t.credited_total,
          t.reversed_total, t.created_at, t.updated_at
        FROM public.rf_coin_topups t JOIN auth.users u ON u.id = t.user_id
        LEFT JOIN public.rf_coin_packages p ON p.id = t.package_id
        WHERE (p_wallet_user_id IS NULL OR t.user_id = p_wallet_user_id)
          AND (p_topup_status IS NULL OR t.status = p_topup_status)
          AND (p_provider IS NULL OR t.provider = p_provider)
          AND t.created_at >= v_from AND t.created_at < v_to
          AND (v_search IS NULL OR t.id::text ILIKE '%' || v_search || '%'
          OR t.user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%'
          OR coalesce(t.provider_reference, '') ILIKE '%' || v_search || '%'
          OR t.provider ILIKE '%' || v_search || '%')
        ORDER BY t.created_at DESC, t.id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'ledger', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_ledger l JOIN auth.users u ON u.id = l.wallet_user_id
        WHERE (p_wallet_user_id IS NULL OR l.wallet_user_id = p_wallet_user_id)
          AND l.created_at >= v_from AND l.created_at < v_to
          AND (v_search IS NULL OR l.wallet_user_id::text ILIKE '%' || v_search || '%'
            OR u.email ILIKE '%' || v_search || '%' OR coalesce(l.reference_id, '') ILIKE '%' || v_search || '%')),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT l.id, l.wallet_user_id, u.email, l.direction, l.amount_coins::text AS amount_coins, l.kind,
          l.balance_after::text AS balance_after, l.reason, l.reference_type, l.reference_id, l.actor_type,
          l.actor_id, l.created_at
        FROM public.rf_coin_ledger l JOIN auth.users u ON u.id = l.wallet_user_id
        WHERE (p_wallet_user_id IS NULL OR l.wallet_user_id = p_wallet_user_id)
          AND l.created_at >= v_from AND l.created_at < v_to
          AND (v_search IS NULL OR l.wallet_user_id::text ILIKE '%' || v_search || '%'
            OR u.email ILIKE '%' || v_search || '%' OR coalesce(l.reference_id, '') ILIKE '%' || v_search || '%')
        ORDER BY l.created_at DESC, l.id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'adjustmentRequests', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_adjustment_requests r
        JOIN auth.users u ON u.id = r.target_user_id
        WHERE (p_wallet_user_id IS NULL OR r.target_user_id = p_wallet_user_id)
          AND r.created_at >= v_from AND r.created_at < v_to
          AND (v_search IS NULL OR r.id::text ILIKE '%' || v_search || '%'
            OR r.target_user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%')),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT r.*, u.email AS target_email
        FROM public.rf_coin_adjustment_requests r JOIN auth.users u ON u.id = r.target_user_id
        WHERE (p_wallet_user_id IS NULL OR r.target_user_id = p_wallet_user_id)
          AND r.created_at >= v_from AND r.created_at < v_to
          AND (v_search IS NULL OR r.id::text ILIKE '%' || v_search || '%'
            OR r.target_user_id::text ILIKE '%' || v_search || '%' OR u.email ILIKE '%' || v_search || '%')
        ORDER BY r.created_at DESC, r.id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'packages', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_packages),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT p.* FROM public.rf_coin_packages p ORDER BY p.sort_order, p.created_at, p.id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'total', (SELECT count(*) FROM public.rf_coin_admin_audit a
        WHERE (p_wallet_user_id IS NULL OR a.target_user_id = p_wallet_user_id)
          AND a.created_at >= v_from AND a.created_at < v_to
          AND (v_search IS NULL OR a.actor_admin_email ILIKE '%' || v_search || '%'
            OR a.action ILIKE '%' || v_search || '%' OR coalesce(a.entity_id, '') ILIKE '%' || v_search || '%'
            OR coalesce(a.target_user_id::text, '') ILIKE '%' || v_search || '%')),
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
        SELECT a.id, a.actor_admin_id, a.actor_admin_email, a.action, a.target_user_id,
          a.entity_type, a.entity_id, a.details, a.created_at
        FROM public.rf_coin_admin_audit a
        WHERE (p_wallet_user_id IS NULL OR a.target_user_id = p_wallet_user_id)
          AND a.created_at >= v_from AND a.created_at < v_to
          AND (v_search IS NULL OR a.actor_admin_email ILIKE '%' || v_search || '%'
            OR a.action ILIKE '%' || v_search || '%' OR coalesce(a.entity_id, '') ILIKE '%' || v_search || '%'
            OR coalesce(a.target_user_id::text, '') ILIKE '%' || v_search || '%')
        ORDER BY a.created_at DESC, a.id
        OFFSET (v_page - 1) * v_page_size LIMIT v_page_size
      ) q), '[]'::jsonb)
    ),
    'trend', coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.day) FROM (
      SELECT (l.created_at AT TIME ZONE 'UTC')::date AS day,
        sum(l.amount_coins) FILTER (WHERE l.kind = 'topup_purchase')::text AS funded,
        sum(l.amount_coins) FILTER (WHERE l.kind = 'order_payment')::text AS spent,
        sum(l.amount_coins) FILTER (WHERE l.kind IN ('order_reversal','chargeback_reversal'))::text AS reversed,
        sum(l.amount_coins) FILTER (WHERE l.kind = 'manual_credit')::text AS manual_credits,
        sum(l.amount_coins) FILTER (WHERE l.kind = 'manual_debit')::text AS manual_debits
      FROM public.rf_coin_ledger l WHERE l.created_at >= v_from AND l.created_at < v_to
      GROUP BY (l.created_at AT TIME ZONE 'UTC')::date ORDER BY day
    ) q), '[]'::jsonb),
    'topupTrend', coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.day, q.status) FROM (
      SELECT (t.created_at AT TIME ZONE 'UTC')::date AS day, t.status, count(*)::text AS count,
        coalesce(sum(t.price_cents), 0)::text AS price_cents
      FROM public.rf_coin_topups t WHERE t.created_at >= v_from AND t.created_at < v_to
      GROUP BY (t.created_at AT TIME ZONE 'UTC')::date, t.status
      ORDER BY day, t.status
    ) q), '[]'::jsonb),
    'walletDistribution', (SELECT jsonb_build_array(
      jsonb_build_object('bucket', '0 RF', 'wallets', zero_count::text),
      jsonb_build_object('bucket', '1–100 RF', 'wallets', low_count::text),
      jsonb_build_object('bucket', '101–1,000 RF', 'wallets', mid_count::text),
      jsonb_build_object('bucket', '1,001–10,000 RF', 'wallets', high_count::text),
      jsonb_build_object('bucket', '10,001+ RF', 'wallets', top_count::text)
    ) FROM (SELECT count(*) FILTER (WHERE balance_coins = 0) AS zero_count,
        count(*) FILTER (WHERE balance_coins BETWEEN 1 AND 100) AS low_count,
        count(*) FILTER (WHERE balance_coins BETWEEN 101 AND 1000) AS mid_count,
        count(*) FILTER (WHERE balance_coins BETWEEN 1001 AND 10000) AS high_count,
        count(*) FILTER (WHERE balance_coins > 10000) AS top_count
      FROM public.rf_coin_wallets) distribution),
    'pendingAging', (SELECT jsonb_build_array(
      jsonb_build_object('age', 'under 1 hour', 'count', under_hour_count::text, 'price_cents', under_hour_cents::text),
      jsonb_build_object('age', '1–24 hours', 'count', one_day_count::text, 'price_cents', one_day_cents::text),
      jsonb_build_object('age', 'over 24 hours', 'count', old_count::text, 'price_cents', old_cents::text)
    ) FROM (SELECT
        count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS under_hour_count,
        coalesce(sum(price_cents) FILTER (WHERE created_at > now() - interval '1 hour'), 0) AS under_hour_cents,
        count(*) FILTER (WHERE created_at <= now() - interval '1 hour' AND created_at > now() - interval '24 hours') AS one_day_count,
        coalesce(sum(price_cents) FILTER (WHERE created_at <= now() - interval '1 hour' AND created_at > now() - interval '24 hours'), 0) AS one_day_cents,
        count(*) FILTER (WHERE created_at <= now() - interval '24 hours') AS old_count,
        coalesce(sum(price_cents) FILTER (WHERE created_at <= now() - interval '24 hours'), 0) AS old_cents
      FROM public.rf_coin_topups WHERE status = 'PENDING') aging),
    'exceptions', jsonb_build_object(
      'total', (SELECT count(*) FROM exceptions)::text,
      'rows', coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.severity_rank, q.occurred_at DESC, q.alert_key)
        FROM (SELECT e.*, CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END AS severity_rank
          FROM exceptions e ORDER BY CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
            e.occurred_at DESC, e.alert_key OFFSET (v_page - 1) * v_page_size LIMIT v_page_size) q), '[]'::jsonb)
    ),
    'range', jsonb_build_object('from', v_from, 'to', v_to, 'timezone', 'UTC'),
    'page', v_page,
    'pageSize', v_page_size,
    'fundingReleaseEnabled', false,
    'spendingReleaseEnabled', false
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Log bounded report exports without storing report rows, provider references,
-- customer emails, or other sensitive export contents in the audit table.
CREATE OR REPLACE FUNCTION public.rf_coin_record_admin_export(
  p_export_type text,
  p_row_count integer,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_email text;
BEGIN
  PERFORM public.rf_coin_assert_super_admin();
  IF p_export_type NOT IN ('wallets','topups','ledger','adjustments','audit','exceptions')
    OR p_row_count < 0 OR p_row_count > 1000
    OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to
    OR p_to - p_from > interval '90 days' THEN
    RAISE EXCEPTION 'RF_COIN_INVALID_EXPORT';
  END IF;

  SELECT a.email INTO v_admin_email FROM public.admins a WHERE a.id = auth.uid() AND a.is_active;
  IF v_admin_email IS NULL THEN RAISE EXCEPTION 'RF_COIN_FORBIDDEN'; END IF;

  INSERT INTO public.rf_coin_admin_audit (
    actor_admin_id, actor_admin_email, action, entity_type, entity_id, details
  ) VALUES (
    auth.uid(), v_admin_email, 'report_export', 'rf_coin_admin_report', p_export_type,
    jsonb_build_object('row_count', p_row_count, 'from', p_from, 'to', p_to, 'format', 'csv')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rf_coin_admin_center_read(text, integer, integer, uuid, timestamptz, timestamptz, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rf_coin_admin_center_read(text, integer, integer, uuid, timestamptz, timestamptz, text, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.rf_coin_record_admin_export(text, integer, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rf_coin_record_admin_export(text, integer, timestamptz, timestamptz)
  TO authenticated;

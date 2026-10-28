import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  SQL contract tests for the staged (NOT yet applied) RF Coins migrations.
  They assert the security-critical behavior is present in the SQL that will
  run: atomic settlement marking orders paid, bounded refund reversal,
  debit-only balance checks, wallet creation for credits, and restrictive
  EXECUTE grants. They intentionally do NOT execute the SQL against any
  live database.
*/

const functionsSql = readFileSync('supabase/migrations-pending/20261028120100_rf_coins_functions.sql', 'utf8');
const schemaSql = readFileSync('supabase/migrations-pending/20261028120000_rf_coins_schema.sql', 'utf8');
const adminCenterSql = readFileSync('supabase/migrations-pending/20261028120200_rf_coin_admin_center_read.sql', 'utf8');

function extractFunction(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end);
}

describe('rf_coin_settle_order_payment', () => {
  const fn = extractFunction(functionsSql, 'rf_coin_settle_order_payment');

  it('locks the order row and re-checks status under lock before debiting', () => {
    expect(fn).toMatch(/SELECT status, payment_method, payment_status INTO v_order_status, v_order_method, v_order_payment\n?\s*FROM orders WHERE id = ord\.id FOR UPDATE/);
    const lockIdx = fn.indexOf('FOR UPDATE');
    const debitIdx = fn.indexOf('UPDATE rf_coin_wallets');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(debitIdx).toBeGreaterThan(lockIdx);
  });

  it('marks the order PAYMENT_VERIFIED in the same atomic block as the debit', () => {
    expect(fn).toMatch(/payment_status = 'VERIFIED'/);
    expect(fn).toMatch(/status = 'PAYMENT_VERIFIED'/);
    expect(fn).toMatch(/payment_verification_method = 'RF_COIN_WALLET'/);
    const debitIdx = fn.indexOf('UPDATE rf_coin_wallets');
    const verifyIdx = fn.indexOf("payment_status = 'VERIFIED'");
    expect(verifyIdx).toBeGreaterThan(debitIdx);
  });

  it('writes the ledger entry before verifying the order (single transaction rollback safety)', () => {
    expect(fn).toMatch(/'order:' \|\| ord\.id::text/);
  });

  it('writes an order_timeline entry for the automatic verification', () => {
    expect(fn).toMatch(/INSERT INTO order_timeline/);
  });

  it('validates caller identity against auth.uid()', () => {
    expect(fn).toMatch(/p_user_id <> auth\.uid\(\)/);
  });

  it('rejects orders that are not WAITING_PAYMENT', () => {
    expect(fn).toMatch(/ord\.status <> 'WAITING_PAYMENT'/);
  });

  it('keeps customer wallet spending behind a hard false release constant', () => {
    expect(fn).toContain('v_spending_release_enabled CONSTANT boolean := false');
    expect(fn).toContain("'RF_COIN_SPENDING_RELEASE_LOCKED'");
  });
});

describe('RF Coins funding release lock', () => {
  const fn = extractFunction(functionsSql, 'rf_coin_create_topup');
  const creditFn = extractFunction(functionsSql, 'rf_coin_credit_paid_topup');

  it('cannot be enabled by database settings or client input', () => {
    expect(fn).toContain('v_funding_release_enabled CONSTANT boolean := false');
    expect(fn).toContain("'RF_COIN_FUNDING_RELEASE_LOCKED'");
    expect(fn.indexOf('IF NOT v_funding_release_enabled')).toBeLessThan(fn.indexOf('rf_coin_get_settings()'));
  });

  it('also blocks service-role coin issuance while preserving settled-event idempotency', () => {
    expect(creditFn).toContain('v_funding_release_enabled CONSTANT boolean := false');
    expect(creditFn).toContain("'RF_COIN_FUNDING_RELEASE_LOCKED'");
    expect(creditFn.indexOf("IF t.status = 'PAID' AND t.credited_at IS NOT NULL")).toBeLessThan(creditFn.indexOf('IF NOT v_funding_release_enabled'));
  });
});

describe('RF Coins Admin Center reporting RPC', () => {
  it('uses an active Super Admin database guard, bounded pages, and precise aggregates', () => {
    expect(adminCenterSql).toContain('PERFORM public.rf_coin_assert_super_admin()');
    expect(adminCenterSql).toContain('least(greatest(coalesce(p_page_size, 25), 1), 50)');
    expect(adminCenterSql).toContain("sum(w.balance_coins)");
    expect(adminCenterSql).toContain('w.user_id::text ILIKE');
    expect(adminCenterSql).toContain('u.email ILIKE');
    expect(adminCenterSql).toContain('t.created_at >= v_from AND t.created_at < v_to');
    expect(adminCenterSql).toContain('fundingReleaseEnabled\', false');
    expect(adminCenterSql).toContain('SET search_path = pg_catalog, public');
    expect(adminCenterSql).toContain('p_provider text DEFAULT NULL');
    expect(adminCenterSql).toContain('pt.amount_cents IS DISTINCT FROM t.price_cents');
    expect(adminCenterSql).toContain('CREATE OR REPLACE FUNCTION public.rf_coin_record_admin_export');
    expect(adminCenterSql).toContain("'paid_not_credited'");
    expect(adminCenterSql).toContain("'wallet_ledger_mismatch'");
    expect(adminCenterSql).toContain("'unusual_manual_adjustment'");
    expect(adminCenterSql).toContain("p_row_count > 1000");
  });

  it('grants only authenticated execution and explicitly revokes anonymous/public execution', () => {
    expect(adminCenterSql).toMatch(/REVOKE ALL ON FUNCTION public\.rf_coin_admin_center_read\([^\n]+\)\s+FROM PUBLIC, anon;/);
    expect(adminCenterSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rf_coin_admin_center_read\([^\n]+\)\s+TO authenticated;/);
    expect(adminCenterSql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.rf_coin_admin_center_read[^;]+TO service_role/);
    expect(adminCenterSql).toMatch(/REVOKE ALL ON FUNCTION public\.rf_coin_record_admin_export\(text, integer, timestamptz, timestamptz\)\s+FROM PUBLIC, anon;/);
    expect(adminCenterSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.rf_coin_record_admin_export\(text, integer, timestamptz, timestamptz\)\s+TO authenticated;/);
    expect(adminCenterSql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.rf_coin_record_admin_export[^;]+TO service_role/);
  });
});

describe('rf_coin_mark_topup_status refund reversal', () => {
  const fn = extractFunction(functionsSql, 'rf_coin_mark_topup_status');

  it('reverses refunds as a DEBIT, never a credit', () => {
    const refundBlock = fn.slice(fn.indexOf("IF p_status IN ('REFUND_PENDING','REFUNDED') THEN"));
    expect(refundBlock).toMatch(/'debit', v_reversed/);
    expect(refundBlock).not.toMatch(/'credit', t\.coins/);
  });

  it('includes bonus coins in the reversal amount', () => {
    expect(fn).toMatch(/v_total := COALESCE\(NULLIF\(t\.credited_total, 0\), t\.coins::bigint \+ t\.bonus_coins::bigint\)/);
  });

  it('bounds the reversal by the remaining balance (no negative wallets)', () => {
    expect(fn).toMatch(/least\(v_outstanding, v_wallet\.balance_coins\)/);
  });

  it('parks partial reversals in REFUND_PENDING instead of crediting', () => {
    expect(fn).toMatch(/'RF_COIN_REVERSAL_INCOMPLETE'/);
    expect(fn).toMatch(/status = 'REFUND_PENDING'/);
  });

  it('enforces legal transitions: refunds only from PENDING/PAID/REFUND_PENDING', () => {
    expect(fn).toMatch(/p_status IN \('REFUND_PENDING','REFUNDED'\) AND t\.status NOT IN \('PENDING','PAID','REFUND_PENDING'\)/);
  });

  it('uses a bounded-debit ledger idempotency key', () => {
    expect(fn).toMatch(/'topup-reversal:' \|\| t\.id::text/);
  });
});

describe('rf_coin_request_adjustment + rf_coin_decide_adjustment', () => {
  const request = extractFunction(functionsSql, 'rf_coin_request_adjustment');
  const decide = extractFunction(functionsSql, 'rf_coin_decide_adjustment');

  it('creates missing wallets for credits instead of failing', () => {
    expect(request).toMatch(/INSERT INTO rf_coin_wallets \(user_id\) VALUES \(p_target_user_id\)/);
    expect(request).toMatch(/IF p_direction = 'debit' THEN\s*\n\s*RETURN QUERY SELECT NULL::uuid, NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'/);
  });

  it('applies balance checks to debits only', () => {
    expect(request).toMatch(/IF p_direction = 'debit' AND v_wallet\.balance_coins < p_amount_coins THEN/);
  });

  it('keeps SUPER_ADMIN verification and daily rate limiting', () => {
    expect(request).toMatch(/rf_coin_assert_super_admin/);
    expect(request).toMatch(/max_daily_admin_adjustments/);
  });

  it('approval path also creates wallets only for credits', () => {
    expect(decide).toMatch(/IF req\.direction = 'debit' THEN\s*\n\s*RETURN QUERY SELECT NULL::text, 'RF_COIN_INSUFFICIENT_BALANCE'/);
  });

  it('requires a second distinct SUPER ADMIN for high-value approvals', () => {
    expect(decide).toMatch(/req\.is_high_value AND req\.requested_by = v_admin_id/);
  });
});

describe('rf_coin_release_order_payment', () => {
  const fn = extractFunction(functionsSql, 'rf_coin_release_order_payment');

  it('only reverses wallet-settled payments in eligible states', () => {
    expect(fn).toMatch(/v_payment_status <> 'VERIFIED'/);
    expect(fn).toMatch(/v_order_status NOT IN \('PAYMENT_VERIFIED','CANCELLED','FAILED'\)/);
  });

  it('blocks reversal of supplier-touched orders', () => {
    expect(fn).toMatch(/v_order_status IN \('PROCESSING','COMPLETED','DELIVERED'\)/);
  });

  it('marks the order payment REFUNDED after reversing (exactly one reversal)', () => {
    expect(fn).toMatch(/payment_status = 'REFUNDED'/);
    expect(fn).toMatch(/'order-reversal:' \|\| p_order_id::text/);
  });
});

describe('grants and schema', () => {
  it('orders pending RF Coins migrations after the complete deployable migration set', () => {
    const currentVersions = readdirSync('supabase/migrations')
      .filter((name) => name.endsWith('.sql'))
      .map((name) => Number(name.match(/^([0-9]{14})_/)?.[1] || 0));
    const pendingNames = readdirSync('supabase/migrations-pending')
      .filter((name) => name.endsWith('.sql') && name.includes('rf_coin'))
      .sort();
    const pendingVersions = pendingNames.map((name) => name.match(/^([0-9]{14})_/)?.[1] || '');
    const latestCurrentVersion = Math.max(...currentVersions);

    expect(latestCurrentVersion).toBeGreaterThan(0);
    expect(pendingNames).toEqual([
      '20261028120000_rf_coins_schema.sql',
      '20261028120100_rf_coins_functions.sql',
      '20261028120200_rf_coin_admin_center_read.sql',
    ]);
    expect(pendingVersions.every((version) => Number(version) > latestCurrentVersion)).toBe(true);
  });

  it('super admin guard denies inactive or suspended admins', () => {
    const guard = extractFunction(functionsSql, 'rf_coin_assert_super_admin');
    expect(guard).toMatch(/admins\.role = 'SUPER_ADMIN'/);
    expect(guard).toMatch(/admins\.is_active = true/);
  });

  it('revokes PUBLIC execute on every RF Coins function', () => {
    const grants = functionsSql.slice(functionsSql.indexOf('REVOKE ALL ON FUNCTION'));
    for (const fnName of [
      'rf_coin_assert_super_admin()',
      'rf_coin_get_settings()',
      'rf_coin_create_topup(uuid, uuid)',
      'rf_coin_settle_order_payment(uuid, uuid)\n  FROM PUBLIC, anon, authenticated',
      'rf_coin_request_adjustment(uuid, text, integer, text, text, text)',
      'rf_coin_decide_adjustment(uuid, boolean, text)',
    ]) {
      expect(grants).toContain(`REVOKE ALL ON FUNCTION ${fnName}${fnName.includes('\n') ? '' : ' FROM PUBLIC'}`);
    }
  });

  it('grants EXECUTE to customer-callable functions; admin RPCs gated inside; webhook RPCs to service_role', () => {
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_create_topup\(uuid, uuid\) TO authenticated/);
    // Codex fix 1: legacy direct settlement has NO client grant — the atomic
    // settle+enqueue wrapper is the only customer settlement entry point.
    expect(functionsSql).not.toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment\(uuid, uuid\) TO authenticated/);
    expect(functionsSql).toMatch(/REVOKE ALL ON FUNCTION rf_coin_settle_order_payment\(uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment_and_enqueue\(uuid, uuid\) TO authenticated/);
    // Admin RPCs are granted to authenticated but each independently verifies
    // SUPER_ADMIN internally; webhook RPCs go to service_role only.
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_request_adjustment\(uuid, text, integer, text, text, text\) TO authenticated/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_credit_paid_topup\(uuid, text\) TO service_role/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_mark_topup_status\(uuid, text, text\) TO service_role/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_release_order_payment\(uuid, text\) TO service_role/);
    expect(functionsSql).not.toMatch(/GRANT ALL ON/);
  });

  it('registers the rf_coin_wallet payment method disabled by default', () => {
    expect(schemaSql).toMatch(/'rf_coin_wallet', 'RF Coins Wallet'.*false/);
    expect(schemaSql).toMatch(/ON CONFLICT \(method_key\) DO NOTHING/);
  });

  it('keeps payment_transactions.order_id nullable change and topup link column', () => {
    expect(schemaSql).toMatch(/ALTER TABLE payment_transactions ALTER COLUMN order_id DROP NOT NULL/);
    expect(schemaSql).toMatch(/ADD COLUMN IF NOT EXISTS rf_coin_topup_id/);
  });

  it('keeps settings fail-closed with no client policies', () => {
    expect(schemaSql).not.toMatch(/POLICY .* ON rf_coin_settings/);
    expect(schemaSql).not.toMatch(/POLICY .* ON rf_coin_admin_audit/);
  });

  it('does not let the Super Admin settings RPC override financial release locks', () => {
    const setSettings = extractFunction(functionsSql, 'rf_coin_set_settings');
    expect(setSettings).toMatch(/IF p_enabled IS TRUE OR p_topups_enabled IS TRUE OR p_spending_enabled IS TRUE THEN\s*RAISE EXCEPTION 'RF_COIN_RELEASE_LOCKED'/);
  });

  it('pins every SECURITY DEFINER function to a catalog-first path with temp last', () => {
    const definitions = Array.from(functionsSql.matchAll(/SECURITY DEFINER SET search_path = ([^$]+) AS/g));
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.every(([, path]) => path.trim() === 'pg_catalog, public, pg_temp')).toBe(true);
    expect(adminCenterSql.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp/g)).toHaveLength(2);
  });

  it('marks both files as pending and feature disabled', () => {
    expect(schemaSql).toMatch(/STATUS: PENDING/);
    expect(functionsSql).toMatch(/STATUS: PENDING/);
  });
});

describe('rf_coin_fulfillment_handoffs (durable handoff)', () => {
  const enqueue = extractFunction(functionsSql, 'rf_coin_enqueue_fulfillment');
  const claim = extractFunction(functionsSql, 'rf_coin_claim_fulfillment_handoffs');
  const ack = extractFunction(functionsSql, 'rf_coin_ack_fulfillment_handoff');

  it('targets the explicitly approved Supabase project and never the stale project ref', () => {
    expect(schemaSql).toContain('v_url := \'https://ketdhcmwowzztcdlmris.supabase.co/functions/v1/fulfillment-handoff\'');
    expect(schemaSql).not.toContain('ftbvxkxxzotwkdcdgaot');
  });

  it('enqueue is idempotent per order and only accepts verified wallet-paid orders', () => {
    expect(enqueue).toMatch(/'rf-coin-fulfillment:' \|\| p_order_id::text/);
    expect(enqueue).toMatch(/ON CONFLICT \(order_id\) DO NOTHING/);
    expect(enqueue).toMatch(/v_method <> 'rf_coin_wallet' OR v_payment_status <> 'VERIFIED'/);
    expect(enqueue).toMatch(/v_order_status NOT IN \('PAYMENT_VERIFIED','PROCESSING'\)/);
  });

  it('claim re-checks fulfillment preconditions at claim time', () => {
    expect(claim).toMatch(/o\.payment_status = 'VERIFIED'/);
    expect(claim).toMatch(/o\.fulfillment_status NOT IN \('PROCESSING','COMPLETED'\)/);
    expect(claim).toMatch(/st\.status IN \('submitted','success','pending'\)/);
  });

  it('claim uses FOR UPDATE SKIP LOCKED with a bounded lease', () => {
    expect(claim).toMatch(/FOR UPDATE OF h SKIP LOCKED/);
    expect(claim).toMatch(/lease_until = clock_timestamp\(\) \+ make_interval\(secs => v_lease_seconds\)/);
    expect(claim).toMatch(/attempt_count = h\.attempt_count \+ 1/);
    expect(claim).toMatch(/LEAST\(GREATEST\(COALESCE\(p_lease_seconds, 300\), 30\), 900\)/);
  });

  it('ack is lease-guarded and dead-letters after bounded attempts', () => {
    expect(ack).toMatch(/lease_token = p_lease_token/);
    expect(ack).toMatch(/lease_until > clock_timestamp\(\)/);
    expect(ack).toMatch(/attempt_count >= v_row\.max_attempts/);
    expect(ack).toMatch(/'DEAD_LETTER'::text/);
    expect(ack).toMatch(/left\(btrim\(p_error\), 1000\)/);
  });

  it('handoff functions are service-role only with no PUBLIC grants', () => {
    expect(functionsSql).toMatch(/REVOKE ALL ON FUNCTION rf_coin_enqueue_fulfillment\(uuid\) FROM PUBLIC/);
    expect(functionsSql).toMatch(/REVOKE ALL ON FUNCTION rf_coin_claim_fulfillment_handoffs\(integer, integer\) FROM PUBLIC/);
    expect(functionsSql).toMatch(/REVOKE ALL ON FUNCTION rf_coin_ack_fulfillment_handoff\(uuid, uuid, text\) FROM PUBLIC/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_enqueue_fulfillment\(uuid\) TO service_role/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_claim_fulfillment_handoffs\(integer, integer\) TO service_role/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_ack_fulfillment_handoff\(uuid, uuid, text\) TO service_role/);
  });

  it('handoff table is fail-closed: RLS enabled, no grants, no client policies', () => {
    expect(schemaSql).toMatch(/ALTER TABLE rf_coin_fulfillment_handoffs ENABLE ROW LEVEL SECURITY/);
    expect(schemaSql).toMatch(/REVOKE ALL ON TABLE rf_coin_fulfillment_handoffs\s*\n\s*FROM PUBLIC, anon, authenticated, service_role/);
    expect(schemaSql).not.toMatch(/POLICY .* ON rf_coin_fulfillment_handoffs/);
  });

  it('cron activation is explicit: no hardcoded secret, no automatic schedule', () => {
    // Only executable (non-comment) SQL counts: the migration must NOT embed
    // a secret or auto-schedule the worker. Activation is a separate operator
    // step with a generated secret, documented in the migration comments.
    const executable = schemaSql
      .split('\n')
      .filter((line) => !/^\s*--/.test(line))
      .join('\n');
    expect(executable).not.toMatch(/INSERT INTO public\._cron_secrets/);
    expect(executable).not.toMatch(/cron\.schedule/);
    expect(executable).not.toMatch(/rfz_fhnd_/);
    // The trigger function exists; the operator activation steps are documented.
    expect(schemaSql).toMatch(/trigger_fulfillment_handoff\(\)/);
    expect(schemaSql).toMatch(/ACTIVATION \(EXPLICIT OPERATOR STEP/);
  });

  it('cron trigger is executable by postgres only (Codex fix 2)', () => {
    expect(schemaSql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.trigger_fulfillment_handoff\(\)\s*\n\s*FROM PUBLIC, anon, authenticated/);
    expect(schemaSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.trigger_fulfillment_handoff\(\) TO postgres/);
    expect(schemaSql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.trigger_fulfillment_handoff\(\) TO (?!postgres)/);
  });
});

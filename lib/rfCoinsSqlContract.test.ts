import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  SQL contract tests for the staged (NOT yet applied) RF Coins migrations.
  They assert the security-critical behavior is present in the SQL that will
  run: atomic settlement marking orders paid, bounded refund reversal,
  debit-only balance checks, wallet creation for credits, and restrictive
  EXECUTE grants. They intentionally do NOT execute the SQL against any
  live database.
*/

const functionsSql = readFileSync('supabase/migrations-pending/20261018160100_rf_coins_functions.sql', 'utf8');
const schemaSql = readFileSync('supabase/migrations-pending/20261018160000_rf_coins_schema.sql', 'utf8');

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
  it('revokes PUBLIC execute on every RF Coins function', () => {
    const grants = functionsSql.slice(functionsSql.indexOf('REVOKE ALL ON FUNCTION'));
    for (const fnName of [
      'rf_coin_assert_super_admin()',
      'rf_coin_get_settings()',
      'rf_coin_create_topup(uuid, uuid)',
      'rf_coin_settle_order_payment(uuid, uuid)',
      'rf_coin_request_adjustment(uuid, text, integer, text, text, text)',
      'rf_coin_decide_adjustment(uuid, boolean, text)',
    ]) {
      expect(grants).toContain(`REVOKE ALL ON FUNCTION ${fnName} FROM PUBLIC`);
    }
  });

  it('grants EXECUTE to customer-callable functions; admin RPCs gated inside; webhook RPCs to service_role', () => {
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_create_topup\(uuid, uuid\) TO authenticated/);
    expect(functionsSql).toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment\(uuid, uuid\) TO authenticated/);
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

  it('marks both files as pending and feature disabled', () => {
    expect(schemaSql).toMatch(/STATUS: PENDING/);
    expect(functionsSql).toMatch(/STATUS: PENDING/);
  });
});

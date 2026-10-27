import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  Contract test for the current staged RF Coins migration chain. In particular,
  it protects against project-level default EXECUTE grants leaking to browser
  roles. These tests inspect SQL only; they never mutate a hosted database.
*/

const functionsSql = readFileSync('supabase/migrations-pending/20261018160100_rf_coins_functions.sql', 'utf8');
const schemaSql = readFileSync('supabase/migrations-pending/20261018160000_rf_coins_schema.sql', 'utf8');

describe('canonical RF Coins ACL contract', () => {
  it('revokes anonymous access from customer and guarded admin RPCs', () => {
    const anonRevokes = [
      'rf_coin_create_topup(uuid, uuid)',
      'rf_coin_settle_order_payment_and_enqueue(uuid, uuid)',
      'rf_coin_request_adjustment(uuid, text, integer, text, text, text)',
      'rf_coin_decide_adjustment(uuid, boolean, text)',
      'rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer)',
      'rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer)',
    ];
    for (const signature of anonRevokes) {
      expect(functionsSql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`);
    }
  });

  it('locks internal and service-role-only functions away from browser roles', () => {
    const lockedRevokes = [
      'rf_coin_assert_super_admin()',
      'rf_coin_get_settings()',
      'rf_coin_get_or_create_wallet(uuid)',
      'rf_coin_credit_paid_topup(uuid, text)',
      'rf_coin_mark_topup_status(uuid, text, text)',
      'rf_coin_release_order_payment(uuid, text)',
      'rf_coin_enqueue_fulfillment(uuid)',
      'rf_coin_claim_fulfillment_handoffs(integer, integer)',
      'rf_coin_ack_fulfillment_handoff(uuid, uuid, text)',
    ];
    for (const signature of lockedRevokes) {
      expect(functionsSql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`);
    }
    expect(functionsSql).toMatch(/REVOKE ALL ON FUNCTION rf_coin_settle_order_payment\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated;/);
  });

  it('locks append-only trigger helpers against direct RPC invocation', () => {
    expect(schemaSql).toContain('REVOKE ALL ON FUNCTION rf_coin_ledger_append_only() FROM PUBLIC, anon, authenticated;');
    expect(schemaSql).toContain('REVOKE ALL ON FUNCTION rf_coin_audit_append_only() FROM PUBLIC, anon, authenticated;');
    expect(schemaSql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.trigger_fulfillment_handoff\(\)\s+FROM PUBLIC, anon, authenticated;/);
  });

  it('grants only the intended authenticated and service-role entry points', () => {
    const grants = [
      ['rf_coin_create_topup(uuid, uuid)', 'authenticated'],
      ['rf_coin_settle_order_payment_and_enqueue(uuid, uuid)', 'authenticated'],
      ['rf_coin_request_adjustment(uuid, text, integer, text, text, text)', 'authenticated'],
      ['rf_coin_decide_adjustment(uuid, boolean, text)', 'authenticated'],
      ['rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer)', 'authenticated'],
      ['rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer)', 'authenticated'],
      ['rf_coin_credit_paid_topup(uuid, text)', 'service_role'],
      ['rf_coin_mark_topup_status(uuid, text, text)', 'service_role'],
      ['rf_coin_release_order_payment(uuid, text)', 'service_role'],
      ['rf_coin_enqueue_fulfillment(uuid)', 'service_role'],
      ['rf_coin_claim_fulfillment_handoffs(integer, integer)', 'service_role'],
      ['rf_coin_ack_fulfillment_handoff(uuid, uuid, text)', 'service_role'],
    ];
    for (const [signature, role] of grants) {
      expect(functionsSql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO ${role};`);
    }
    expect(functionsSql).not.toMatch(/GRANT EXECUTE ON FUNCTION rf_coin_settle_order_payment\(uuid, uuid\) TO authenticated/);
  });

  it('keeps the pending RPC bodies free of the previously observed runtime defects', () => {
    const ackStart = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_ack_fulfillment_handoff');
    const ackEnd = functionsSql.indexOf('EXECUTE GRANT CORRECTIONS', ackStart);
    const ack = functionsSql.slice(ackStart, ackEnd > ackStart ? ackEnd : undefined);
    expect(ack).not.toMatch(/Ieff\(/);
    expect(ack).toContain('left(btrim(p_error), 1000)');

    const settingsStart = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_set_settings');
    const settingsEnd = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_ack_fulfillment_handoff', settingsStart);
    const settings = functionsSql.slice(settingsStart, settingsEnd);
    expect(settings).not.toContain('v_coin_settings');
    expect(settings).toContain('centavos_per_coin = COALESCE(p_centavos_per_coin, v_old.centavos_per_coin)');
  });

  it('keeps wallet funding/spending disabled and fulfillment cron unscheduled', () => {
    expect(schemaSql).toMatch(/enabled boolean NOT NULL DEFAULT false/);
    expect(schemaSql).toMatch(/topups_enabled boolean NOT NULL DEFAULT false/);
    expect(schemaSql).toMatch(/spending_enabled boolean NOT NULL DEFAULT false/);
    expect(schemaSql).toMatch(/'rf_coin_wallet', 'RF Coins Wallet', 'rf_coin_wallet', false/);
    expect(schemaSql).not.toMatch(/^\s*SELECT\s+cron\.schedule\(/m);
    expect(schemaSql).not.toMatch(/^\s*INSERT INTO public\._cron_secrets/m);
  });

  it('does not broaden project defaults or mutate the live database during tests', () => {
    expect(functionsSql).not.toMatch(/^\s*ALTER DEFAULT PRIVILEGES/m);
    expect(schemaSql).not.toMatch(/^\s*ALTER DEFAULT PRIVILEGES/m);
    expect(schemaSql).toContain('-- STATUS: PENDING — NOT applied to the live database.');
  });
});

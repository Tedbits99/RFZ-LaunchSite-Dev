import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  Contract test for the corrective RF Coins security remediation migration.
  The live database initially inherited EXECUTE grants for anon/authenticated
  from platform default privileges; the original migration only revoked PUBLIC.
  This test asserts the corrective migration explicitly revokes those direct
  grants and re-asserts the intended per-role grants. It does not execute any
  SQL against a live database.
*/

const remediationSql = readFileSync(
  'supabase/migrations/20261019020000_rf_coins_security_remediation.sql',
  'utf8',
);

describe('rf_coins ACL remediation contract', () => {
  it('revokes anon from every customer/admin RPC that must not be anonymous', () => {
    const anonRevokes = [
      'public.rf_coin_create_topup(uuid, uuid)',
      'public.rf_coin_settle_order_payment_and_enqueue(uuid, uuid)',
      'public.rf_coin_request_adjustment(uuid, text, integer, text, text, text)',
      'public.rf_coin_decide_adjustment(uuid, boolean, text)',
      'public.rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer)',
      'public.rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer)',
    ];
    for (const fn of anonRevokes) {
      expect(remediationSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon;`);
    }
  });

  it('revokes anon AND authenticated from service-role-only and helper RPCs', () => {
    const lockedRevokes = [
      'public.rf_coin_get_settings()',
      'public.rf_coin_assert_super_admin()',
      'public.rf_coin_get_or_create_wallet(uuid)',
      'public.rf_coin_credit_paid_topup(uuid, text)',
      'public.rf_coin_mark_topup_status(uuid, text, text)',
      'public.rf_coin_release_order_payment(uuid, text)',
      'public.rf_coin_enqueue_fulfillment(uuid)',
      'public.rf_coin_claim_fulfillment_handoffs(integer, integer)',
      'public.rf_coin_ack_fulfillment_handoff(uuid, uuid, text)',
    ];
    for (const fn of lockedRevokes) {
      expect(remediationSql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM anon, authenticated;`);
    }
  });

  it('re-asserts the intended grants with no privilege expansion', () => {
    const grants = [
      ['public.rf_coin_create_topup(uuid, uuid)', 'authenticated'],
      ['public.rf_coin_settle_order_payment_and_enqueue(uuid, uuid)', 'authenticated'],
      ['public.rf_coin_request_adjustment(uuid, text, integer, text, text, text)', 'authenticated'],
      ['public.rf_coin_decide_adjustment(uuid, boolean, text)', 'authenticated'],
      ['public.rf_coin_set_settings(boolean, boolean, boolean, integer, integer, integer)', 'authenticated'],
      ['public.rf_coin_upsert_package(uuid, text, integer, integer, integer, boolean, integer)', 'authenticated'],
      ['public.rf_coin_credit_paid_topup(uuid, text)', 'service_role'],
      ['public.rf_coin_mark_topup_status(uuid, text, text)', 'service_role'],
      ['public.rf_coin_release_order_payment(uuid, text)', 'service_role'],
      ['public.rf_coin_enqueue_fulfillment(uuid)', 'service_role'],
      ['public.rf_coin_claim_fulfillment_handoffs(integer, integer)', 'service_role'],
      ['public.rf_coin_ack_fulfillment_handoff(uuid, uuid, text)', 'service_role'],
    ];
    for (const [fn, role] of grants) {
      expect(remediationSql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO ${role};`);
    }
  });

  it('does not touch legacy settlement, the cron trigger, or default privileges', () => {
    expect(remediationSql).not.toMatch(/ON FUNCTION (public\.)?rf_coin_settle_order_payment\(uuid, uuid\)/);
    expect(remediationSql).not.toMatch(/ON FUNCTION (public\.)?trigger_fulfillment_handoff/);
    expect(remediationSql).not.toMatch(/^ALTER DEFAULT PRIVILEGES/m);
  });

  it('does not activate RF Coins, cron, or secrets', () => {
    expect(remediationSql).not.toMatch(/cron\.schedule/);
    expect(remediationSql).not.toMatch(/INSERT INTO .*_cron_secrets/);
    expect(remediationSql).not.toMatch(/enabled = true/i);
    expect(remediationSql).not.toMatch(/is_enabled = true/i);
  });

  it('repairs the two latent runtime defects from the drifted definitions', () => {
    const ack = remediationSql.slice(
      remediationSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_ack_fulfillment_handoff'),
      remediationSql.indexOf('EXECUTE GRANT CORRECTIONS'),
    );
    expect(ack).not.toMatch(/Ieff\(/);
    expect(ack).toMatch(/left\(btrim\(p_error\), 1000\)/);

    const settings = remediationSql.slice(
      remediationSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_set_settings'),
      remediationSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_ack_fulfillment_handoff'),
    );
    expect(settings).not.toMatch(/v_coin_settings/);
    expect(settings).toMatch(/centavos_per_coin = COALESCE\(p_centavos_per_coin, v_old\.centavos_per_coin\)/);
  });
});

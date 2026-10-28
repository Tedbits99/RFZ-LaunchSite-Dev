import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  Contract test for the RF Coins migration chain proposed in the draft PR. In
  particular, it protects against project-level default EXECUTE grants leaking
  to browser roles. These tests inspect SQL only; they never mutate a hosted DB.
*/

const functionsSql = readFileSync('supabase/migrations/20261028120100_rf_coins_functions.sql', 'utf8');
const schemaSql = readFileSync('supabase/migrations/20261028120000_rf_coins_schema.sql', 'utf8');
const adminCenterSql = readFileSync('supabase/migrations/20261028120200_rf_coin_admin_center_read.sql', 'utf8');
const supportedAclPath = 'supabase/migrations/20261028113000_revoke_browser_table_ddl_privileges.sql';
const stalePendingAclPath = 'supabase/migrations-pending/20261028113000_revoke_browser_table_ddl_privileges.sql';
const supportedAclSql = readFileSync(supportedAclPath, 'utf8');
const providerAclSql = readFileSync('supabase/migrations-pending-provider/20261028113100_revoke_supabase_admin_browser_defaults.sql', 'utf8');
const aclRehearsal = readFileSync('scripts/test-hosted-acl-remediation-postgres17.sh', 'utf8');

describe('canonical RF Coins ACL contract', () => {
  it('uses the single reviewed ACL migration already in the deployable main sequence', () => {
    expect(existsSync(supportedAclPath)).toBe(true);
    expect(existsSync(stalePendingAclPath)).toBe(false);
  });

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

  it('locks append-only helpers and omits the outbound dispatcher', () => {
    expect(schemaSql).toContain('REVOKE ALL ON FUNCTION rf_coin_ledger_append_only() FROM PUBLIC, anon, authenticated;');
    expect(schemaSql).toContain('REVOKE ALL ON FUNCTION rf_coin_audit_append_only() FROM PUBLIC, anon, authenticated;');
    expect(schemaSql).not.toContain('trigger_fulfillment_handoff');
  });

  it('removes inherited table defaults and restores only the intended RF Coins read grants', () => {
    expect(schemaSql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE rf_coin_settings, rf_coin_wallets, rf_coin_ledger,[\s\S]*?FROM PUBLIC, anon, authenticated;/);
    expect(schemaSql).toMatch(/GRANT SELECT ON rf_coin_settings, rf_coin_wallets, rf_coin_ledger,[\s\S]*?TO anon, authenticated;/);
    expect(schemaSql).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\._cron_secrets\s+FROM PUBLIC, anon, authenticated, service_role;/);
    expect(schemaSql).toMatch(/REVOKE ALL ON TABLE rf_coin_fulfillment_handoffs\s+FROM PUBLIC, anon, authenticated, service_role;/);
  });

  it('rehearses inherited PostgreSQL 17 MAINTAIN and other default ACLs before asserting effective denial', () => {
    const fixture = readFileSync('supabase/tests/database/rf-coins-default-acl-fixture.sql', 'utf8');
    const upgradeAssertions = readFileSync('supabase/tests/database/rf-coins-current-schema-upgrade.sql', 'utf8');
    const harness = readFileSync('scripts/test-github-actions-database-security.sh', 'utf8');
    expect(fixture).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public');
    expect(fixture).toContain('GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;');
    expect(fixture).toContain("'REFERENCES', 'TRIGGER', 'MAINTAIN'");
    expect(fixture).toContain('RF_COINS_POSTGRES17_DEFAULT_ACL_FIXTURE_PASS');
    expect(upgradeAssertions).toContain("'REFERENCES', 'TRIGGER', 'MAINTAIN'");
    expect(upgradeAssertions).toContain('RF_COINS_BROWSER_PRIVILEGE_NOT_REVOKED');
    expect(harness).toContain('major_version = 17');
    expect(harness).toContain('--file supabase/tests/database/rf-coins-default-acl-fixture.sql');
  });

  it('grants only the intended authenticated and service-role entry points', () => {
    const grants = [
      ['rf_coin_get_or_create_wallet(uuid)', 'authenticated'],
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
    expect(adminCenterSql).toContain('REVOKE ALL ON FUNCTION public.rf_coin_admin_center_read(text, integer, integer, uuid, timestamptz, timestamptz, text, text, text)\n  FROM PUBLIC, anon;');
    expect(adminCenterSql).toContain('GRANT EXECUTE ON FUNCTION public.rf_coin_admin_center_read(text, integer, integer, uuid, timestamptz, timestamptz, text, text, text)\n  TO authenticated;');
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

  it('limits the hosted postgres ACL migration to its audited authority and exact grants', () => {
    expect(supportedAclSql).toContain('current_user <> \'postgres\'');
    expect(supportedAclSql).toContain("v_direct_count NOT IN (0, 204)");
    expect(supportedAclSql).toContain("v_postgres_default_count NOT IN (0, 16)");
    expect(supportedAclSql).toContain("v_provider_default_count NOT IN (0, 24)");
    expect(supportedAclSql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public');
    expect(supportedAclSql).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage');
    expect(supportedAclSql).not.toContain('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin');
    expect(supportedAclSql).not.toContain('SET ROLE supabase_admin');
    expect(supportedAclSql).toContain('FROM anon, authenticated;');
  });

  it('keeps provider-owned ACL work outside normal migrations and rehearses role boundaries', () => {
    expect(providerAclSql).toContain('PROVIDER-AUTHORIZED ACL OPERATION; NOT A NORMAL SUPABASE MIGRATION');
    expect(providerAclSql).toContain('PROVIDER_ACL_SUPABASE_ADMIN_AUTHORITY_REQUIRED');
    expect(providerAclSql).toContain('IN SCHEMA graphql');
    expect(providerAclSql).toContain('IN SCHEMA graphql_public');
    expect(aclRehearsal).toContain('--env POSTGRES_USER=bootstrap');
    expect(aclRehearsal).toContain('postgresql://${role}@127.0.0.1:5432/postgres');
    expect(aclRehearsal).toContain('psql_in_container postgres');
    expect(aclRehearsal).not.toContain('psql_in_container supabase_admin');
    expect(aclRehearsal).toContain('provider_audited_defaults_preserved=24');
    expect(aclRehearsal).toContain('read-only');
  });

  it('serializes same-package top-up retries and prevents duplicate pending attempts', () => {
    expect(schemaSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS rf_coin_topups_one_pending_package_per_user\s+ON rf_coin_topups \(user_id, package_id\) WHERE status = 'PENDING' AND package_id IS NOT NULL;/);
    const start = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_create_topup');
    const end = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_credit_paid_topup', start);
    const createTopup = functionsSql.slice(start, end);
    expect(createTopup).toContain('FROM auth.users WHERE id = p_user_id FOR UPDATE');
    expect(createTopup).toContain("WHERE user_id = p_user_id AND package_id = pkg.id AND status = 'PENDING'");
    expect(createTopup).toContain('RETURN QUERY SELECT pending_topup.id');
  });

  it('requires the wallet itself and top-ups to be enabled before a top-up can be created', () => {
    const start = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_create_topup');
    const end = functionsSql.indexOf('CREATE OR REPLACE FUNCTION rf_coin_credit_paid_topup', start);
    const createTopup = functionsSql.slice(start, end);
    expect(createTopup).toMatch(/IF NOT s\.enabled THEN[\s\S]*?'RF_COIN_DISABLED'/);
    expect(createTopup).toMatch(/IF NOT s\.topups_enabled THEN[\s\S]*?'RF_COIN_TOPUPS_DISABLED'/);
    expect(createTopup.indexOf('IF NOT s.enabled')).toBeLessThan(createTopup.indexOf('IF NOT s.topups_enabled'));
  });

  it('does not broaden project defaults or mutate the live database during tests', () => {
    expect(functionsSql).not.toMatch(/^\s*ALTER DEFAULT PRIVILEGES/m);
    expect(schemaSql).not.toMatch(/^\s*ALTER DEFAULT PRIVILEGES/m);
    expect(schemaSql).toContain('schema installation alone does not enable wallet use.');
    expect(functionsSql).toContain('v_funding_release_enabled CONSTANT boolean := false');
    expect(functionsSql).toContain('v_spending_release_enabled CONSTANT boolean := false');
  });
});

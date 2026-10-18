/*
  Real PostgreSQL execution tests for the staged RF Coins migrations.

  Runs both PENDING migration files inside an in-process PostgreSQL (PGlite),
  then exercises the actual RPC behavior under real roles: settlement,
  double-payment protection, cross-method rejection, top-up crediting,
  duplicate webhook idempotency, partial refund reversal without double
  debit, admin adjustments, permission grants, and supplier scheduling
  preconditions. No live database, no network, no supplier or payment calls.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const schemaSql = readFileSync(join(projectRoot, 'supabase/migrations-pending/20261018160000_rf_coins_schema.sql'), 'utf8');
const functionsSql = readFileSync(join(projectRoot, 'supabase/migrations-pending/20261018160100_rf_coins_functions.sql'), 'utf8');

let db: PGlite;

async function sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
  const res = await db.query(query, params as never[]);
  return res.rows as T[];
}

const CUSTOMER = '11111111-1111-1111-1111-111111111111';
const CUSTOMER2 = '22222222-2222-2222-2222-222222222222';
const SUPER_ADMIN = '33333333-3333-3333-3333-333333333333';
const REGULAR_ADMIN = '44444444-4444-4444-4444-444444444444';
const GAME = '55555555-5555-5555-5555-555555555555';
const PACKAGE = '66666666-6666-6666-6666-666666666666';

// PGlite runs each statement in its own transaction, so transaction-local
// set_config values vanish immediately; use session-level settings instead.
// Claims go through db.exec as an escaped literal (bind params serialize
// json-typed arguments in a way set_config's text argument rejects).
async function setClaims(claims: Record<string, unknown> | null) {
  const literal = claims === null ? '' : JSON.stringify(claims).replace(/'/g, "''");
  await db.exec(`SELECT set_config('request.jwt.claims', '${literal}', false)`);
}

async function asRole(role: 'anon' | 'authenticated' | 'service_role', userId?: string) {
  // Emulate Supabase PostgREST role/claim injection exactly as in production.
  // Both settings must be session-level: PGlite wraps each statement in its
  // own transaction, so is_local values vanish before the next statement.
  await db.exec(`SELECT set_config('role', '${role}', false)`);
  if (role === 'authenticated' && userId) {
    await setClaims({ sub: userId, role: 'authenticated' });
  } else {
    await setClaims({ role });
  }
}

async function resetRole() {
  await sql(`RESET ROLE`);
  await setClaims(null);
}

// Order fixture directly through SQL (create_order RPC needs more catalog);
// the settlement RPC only needs a valid orders row.
async function insertOrder(opts: {
  id: string;
  userId?: string | null;
  method?: string;
  status?: string;
  paymentStatus?: string;
  totalCents?: number;
}) {
  await sql(
    `INSERT INTO orders (id, reference, email, customer_name, game_id, package_id,
       player_inputs, quantity, subtotal_cents, discount_cents, total_cents,
       payment_method, status, payment_status, fulfillment_status, customer_user_id)
     VALUES ($1, $2, 'cust@example.invalid', 'Customer', $3, $4, '{}'::jsonb, 1,
       $5, 0, $5, $6, $7, $8, 'NOT_STARTED', $9)`,
    [opts.id, 'RF-' + opts.id.slice(-12), GAME, PACKAGE,
     opts.totalCents ?? 50000,
     opts.method ?? 'rf_coin_wallet',
     opts.status ?? 'WAITING_PAYMENT',
     opts.paymentStatus ?? 'UNPAID',
     opts.userId ?? null],
  );
}

async function createWallet(userId: string, balance: number) {
  await sql(`INSERT INTO rf_coin_wallets (user_id, balance_coins) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET balance_coins = $2`, [userId, balance]);
}

beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase-compatible environment: auth schema + uid() + roles.
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
    $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

    -- Fixture baseline: the existing tables the RF Coins migration
    -- references, mirroring the live production shapes (subset of columns).
    CREATE TABLE games (
      id uuid PRIMARY KEY,
      slug text UNIQUE NOT NULL,
      name text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE packages (
      id uuid PRIMARY KEY,
      game_id uuid NOT NULL REFERENCES games(id),
      name text NOT NULL,
      price_cents integer NOT NULL CHECK (price_cents >= 0),
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE admins (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      name text NOT NULL DEFAULT 'Admin',
      role text NOT NULL DEFAULT 'SUPER_ADMIN',
      claimed_at timestamptz NOT NULL DEFAULT now(),
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE orders (
      id uuid PRIMARY KEY,
      reference text UNIQUE NOT NULL,
      email text NOT NULL,
      customer_name text NOT NULL,
      game_id uuid NOT NULL REFERENCES games(id),
      package_id uuid NOT NULL REFERENCES packages(id),
      player_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
      quantity integer NOT NULL DEFAULT 1,
      subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
      discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
      fee_cents integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
      total_cents integer NOT NULL CHECK (total_cents >= 0),
      payment_method text NOT NULL DEFAULT 'manual',
      status text NOT NULL DEFAULT 'WAITING_PAYMENT',
      payment_status text NOT NULL DEFAULT 'UNPAID',
      payment_verification_method text,
      payment_verified_at timestamptz,
      payment_verified_by text,
      fulfillment_status text NOT NULL DEFAULT 'NOT_STARTED',
      customer_user_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE order_timeline (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status text NOT NULL,
      actor_email text,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_config (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      method_key text UNIQUE NOT NULL,
      display_name text NOT NULL,
      provider text NOT NULL DEFAULT 'manual',
      provider_name text NOT NULL DEFAULT 'manual',
      provider_type text NOT NULL DEFAULT 'manual',
      api_url text,
      currency text NOT NULL DEFAULT 'PHP',
      is_test_mode boolean NOT NULL DEFAULT false,
      min_amount_cents integer,
      max_amount_cents integer,
      is_enabled boolean NOT NULL DEFAULT true,
      account_name text NOT NULL DEFAULT '',
      account_number text NOT NULL DEFAULT '',
      qr_data text,
      instructions text NOT NULL DEFAULT '',
      webhook_url text,
      test_mode boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE payment_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
      idempotency_key text UNIQUE,
      provider_name text NOT NULL DEFAULT '',
      provider_reference text,
      action text NOT NULL DEFAULT 'create',
      status text NOT NULL DEFAULT 'pending',
      amount_cents int NOT NULL DEFAULT 0,
      currency text NOT NULL DEFAULT 'PHP',
      checkout_url text,
      webhook_payload jsonb,
      error_message text,
      metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE supplier_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL,
      mapping_id uuid,
      idempotency_key text UNIQUE,
      action text NOT NULL DEFAULT 'create_order',
      status text NOT NULL DEFAULT 'pending',
      supplier_reference text,
      request_payload jsonb,
      response_payload jsonb,
      error_message text,
      attempt int NOT NULL DEFAULT 1,
      duration_ms int,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- cron/net stubs so the staged cron-scheduling SQL can execute in PGlite.
    CREATE SCHEMA IF NOT EXISTS cron;
    CREATE FUNCTION cron.schedule(name text, schedule text, command text)
      RETURNS bigint LANGUAGE sql AS $stub$ SELECT 1::bigint $stub$;
    CREATE SCHEMA IF NOT EXISTS net;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int)
      RETURNS bigint LANGUAGE sql AS $stub$ SELECT 1::bigint $stub$;
  `);
  await db.exec(schemaSql);
  await db.exec(functionsSql);

  // Fixture identities and catalog.
  await sql(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ($1, 'cust@example.invalid', now()),
    ($2, 'cust2@example.invalid', now()),
    ($3, 'super@example.invalid', now()),
    ($4, 'regular@example.invalid', now())`,
    [CUSTOMER, CUSTOMER2, SUPER_ADMIN, REGULAR_ADMIN]);
  await sql(`INSERT INTO admins (id, email, name, role) VALUES
    ($1, 'super@example.invalid', 'Super', 'SUPER_ADMIN'),
    ($2, 'regular@example.invalid', 'Regular', 'ADMIN')`,
    [SUPER_ADMIN, REGULAR_ADMIN]);
  await sql(`INSERT INTO games (id, slug, name) VALUES ($1, 'test-game', 'Test Game')`, [GAME]);
  await sql(`INSERT INTO packages (id, game_id, name, price_cents) VALUES ($1, $2, 'Test Pkg', 50000)`,
    [PACKAGE, GAME]);
  await sql(`INSERT INTO rf_coin_packages (id, name, coins, bonus_coins, price_cents)
    VALUES ($1, '100 Coins', 100, 10, 10000)`, ['77777777-7777-7777-7777-777777777777']);
  await sql(`UPDATE rf_coin_settings SET enabled = true, topups_enabled = true, spending_enabled = true WHERE id = 1`);

  // Table privileges: the live project's default privileges grant SELECT to
  // anon/authenticated on customer-readable tables; RLS then filters rows.
  // Without these grants the RLS tests fail on ACL instead of proving the
  // policy behavior.
  await sql(`GRANT SELECT ON games, packages, admins, orders, order_timeline,
    payment_config, payment_transactions TO anon, authenticated, service_role`);
}, 120_000);

afterAll(async () => { await db.close(); });

describe('rf coins real SQL behavior', () => {
  it('admin credits work: low-value credit applies immediately with audit + ledger', async () => {
    await asRole('authenticated', SUPER_ADMIN);
    const res = await sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 100, 'goodwill gesture here', 'promotion', 'test-adj-1')`,
      [CUSTOMER]);
    expect(res[0].out_error).toBeNull();
    expect(res[0].out_status).toBe('APPLIED');
    await resetRole();

    const wallet = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER]);
    expect(Number(wallet[0].balance_coins)).toBe(100);
    const audit = await sql(`SELECT 1 FROM rf_coin_admin_audit WHERE action = 'adjustment_applied'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('regular admin and anon cannot run admin RPCs', async () => {
    await asRole('authenticated', REGULAR_ADMIN);
    const res = await sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 5, 'not allowed here', 'promotion', 'test-adj-2')`, [CUSTOMER]);
    expect(res[0].out_error).toBe('RF_COIN_FORBIDDEN');
    await resetRole();

    await asRole('anon');
    await expect(sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 5, 'not allowed here', 'promotion', 'test-adj-3')`, [CUSTOMER]))
      .rejects.toThrow(/permission denied|rf_coin_request_adjustment/i);
    await resetRole();
  });

  it('suspended or inactive super admins are denied admin RPCs', async () => {
    const SUSPENDED_ADMIN = '55555555-5555-5555-5555-555555555551';
    await sql(`INSERT INTO auth.users (id, email) VALUES ($1, 'suspended@example.invalid')`,
      [SUSPENDED_ADMIN]);
    await sql(`INSERT INTO admins (id, email, name, role, is_active) VALUES
      ($1, 'suspended@example.invalid', 'Suspended', 'SUPER_ADMIN', false)`,
      [SUSPENDED_ADMIN]);

    // Suspended super admin: identity matches, role matches, is_active=false.
    await asRole('authenticated', SUSPENDED_ADMIN);
    const res = await sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 5, 'suspended admin denied', 'promotion', 'test-adj-suspended')`, [CUSTOMER]);
    expect(res[0].out_error).toBe('RF_COIN_FORBIDDEN');

    // set_settings is a void RPC: the guard raises instead of returning an
    // error column, so the denial surfaces as an exception.
    await expect(sql(`SELECT rf_coin_set_settings(true, null, null, null, null, null)`))
      .rejects.toThrow(/RF_COIN_FORBIDDEN/);
    await resetRole();

    const settings = await sql<{ enabled: boolean }>(`SELECT enabled FROM rf_coin_settings WHERE id = 1`);
    expect(settings[0].enabled).toBe(true); // unchanged by the inactive admin

    // No audit row was written by either denied admin.
    const audit = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_admin_audit WHERE actor_admin_id = ANY($1::uuid[])`,
      [[SUSPENDED_ADMIN]]);
    expect(Number(audit[0].n)).toBe(0);
  });

  it('settlement debits once, verifies payment atomically, and rejects double payment', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000001';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER, 1000); // 50000 cents / 100 = 500 coins needed

    await asRole('authenticated', CUSTOMER);
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`,
      [orderId, CUSTOMER]);
    expect(res[0].out_error).toBeNull();
    expect(res[0].out_coins).toBe(500);
    expect(String(res[0].out_balance_after)).toBe('500');
    await resetRole();

    const order = await sql<{ status: string; payment_status: string; payment_verification_method: string }>(
      `SELECT status, payment_status, payment_verification_method FROM orders WHERE id = $1`, [orderId]);
    expect(order[0].status).toBe('PAYMENT_VERIFIED');
    expect(order[0].payment_status).toBe('VERIFIED');
    expect(order[0].payment_verification_method).toBe('RF_COIN_WALLET');

    // Double settlement returns the original result — no second debit.
    await asRole('authenticated', CUSTOMER);
    const res2 = await sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER]);
    await resetRole();
    expect(res2[0].out_error).toBeNull();
    expect(res2[0].out_coins).toBe(500);
    const ledgerCount = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_ledger WHERE reference_id = $1 AND kind = 'order_payment'`, [orderId]);
    expect(Number(ledgerCount[0].n)).toBe(1);

    // Fulfillment preconditions: gate invariants a scheduled claim relies on.
    const gate = await sql<{ payment_status: string; fulfillment_status: string }>(
      `SELECT payment_status, fulfillment_status FROM orders WHERE id = $1`, [orderId]);
    expect(gate[0].payment_status).toBe('VERIFIED');
    expect(gate[0].fulfillment_status).toBe('NOT_STARTED'); // claimable by complete_fulfillment
  });

  it('settlement rejects orders created for other payment methods (cross-method protection)', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000002';
    await insertOrder({ id: orderId, userId: CUSTOMER, method: 'paymongo_qrph', totalCents: 50000 });
    await createWallet(CUSTOMER, 1000);

    await asRole('authenticated', CUSTOMER);
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER]);
    await resetRole();
    expect(res[0].out_error).toBe('RF_COIN_ORDER_WRONG_METHOD');
    const order = await sql<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(order[0].status).toBe('WAITING_PAYMENT');
    const bal = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER]);
    expect(Number(bal[0].balance_coins)).toBe(1000); // untouched
  });

  it('settlement rejects a different user settling someone else order', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000003';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER2, 1000);

    await asRole('authenticated', CUSTOMER2);
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER2]);
    await resetRole();
    expect(['RF_COIN_FORBIDDEN', 'RF_COIN_INSUFFICIENT_BALANCE']).toContain(res[0].out_error);
  });

  it('top-up crediting is idempotent under duplicate webhook calls', async () => {
    await asRole('authenticated', CUSTOMER);
    const pkg = await sql<{ id: string }>(
      `SELECT id FROM rf_coin_packages WHERE is_active = true LIMIT 1`);
    const created = await sql<{ out_topup_id: string }>(
      `SELECT * FROM rf_coin_create_topup($1, $2)`, [CUSTOMER, pkg[0].id]);
    expect(created[0].out_topup_id).toBeTruthy();
    const topupId = created[0].out_topup_id;
    await resetRole();

    await asRole('service_role');
    const c1 = await sql<{ out_credited: boolean; out_error: string | null }>(
      `SELECT * FROM rf_coin_credit_paid_topup($1, 'pay-ref-1')`, [topupId]);
    const c2 = await sql<{ out_credited: boolean; out_error: string | null }>(
      `SELECT * FROM rf_coin_credit_paid_topup($1, 'pay-ref-1')`, [topupId]);
    await resetRole();
    expect(c1[0].out_error).toBeNull();
    expect(c1[0].out_credited).toBe(true);
    expect(c2[0].out_error).toBeNull(); // duplicate returns settled state
    const ledgerCount = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_ledger WHERE idempotency_key = 'topup:' || $1::text`, [topupId]);
    expect(Number(ledgerCount[0].n)).toBe(1);
  });

  it('partial refund reversal debits bounded, never double-debits, and stays pending', async () => {
    // Customer2: credited 1000 (900 + 100 bonus), spends 900, wallet has 100.
    await createWallet(CUSTOMER2, 100);
    const topup = await sql<{ id: string; credited_total: string }>(
      `INSERT INTO rf_coin_topups (user_id, package_id, coins, bonus_coins, price_cents,
         status, idempotency_key, credited_at, credited_total)
       VALUES ($1, NULL, 900, 100, 90000, 'PAID', 'test-reversal-topup-1', now(), 1000)
       RETURNING id, credited_total`, [CUSTOMER2]);
    const topupId = topup[0].id;
    expect(Number(topup[0].credited_total)).toBe(1000);

    await asRole('service_role');
    // First refund attempt: only 100 reversible → partial, stays REFUND_PENDING.
    const r1 = await sql<{ out_ok: boolean; out_error: string | null }>(
      `SELECT * FROM rf_coin_mark_topup_status($1, 'REFUNDED', 'ref-1')`, [topupId]);
    expect(r1[0].out_ok).toBe(false);
    expect(r1[0].out_error).toBe('RF_COIN_REVERSAL_INCOMPLETE');
    await resetRole();

    let state = await sql<{ status: string; reversed_total: string; credited_total?: string }>(
      `SELECT status, reversed_total FROM rf_coin_topups WHERE id = $1`, [topupId]);
    expect(state[0].status).toBe('REFUND_PENDING');
    expect(Number(state[0].reversed_total)).toBe(100);

    // Wallet now 0. A re-run must not go negative and must not double-debit.
    await asRole('service_role');
    const r2 = await sql<{ out_ok: boolean; out_error: string | null }>(
      `SELECT * FROM rf_coin_mark_topup_status($1, 'REFUNDED', 'ref-1')`, [topupId]);
    await resetRole();
    expect(r2[0].out_ok).toBe(false);
    state = await sql<{ status: string; reversed_total: string }>(
      `SELECT status, reversed_total FROM rf_coin_topups WHERE id = $1`, [topupId]);
    expect(Number(state[0].reversed_total)).toBe(100);
    const bal = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER2]);
    expect(Number(bal[0].balance_coins)).toBe(0);

    // Admin tops the wallet back up; reconciliation resumes and completes.
    await createWallet(CUSTOMER2, 900);
    await asRole('service_role');
    const r3 = await sql<{ out_ok: boolean; out_error: string | null }>(
      `SELECT * FROM rf_coin_mark_topup_status($1, 'REFUNDED', 'ref-1')`, [topupId]);
    await resetRole();
    expect(r3[0].out_ok).toBe(true);
    expect(r3[0].out_error).toBeNull();
    state = await sql<{ status: string; reversed_total: string; credited_total: string }>(
      `SELECT status, reversed_total, credited_total FROM rf_coin_topups WHERE id = $1`, [topupId]);
    expect(state[0].status).toBe('REFUNDED');
    expect(Number(state[0].reversed_total)).toBe(1000);
    expect(Number(state[0].credited_total)).toBe(1000);
    const bal2 = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER2]);
    expect(Number(bal2[0].balance_coins)).toBe(0);

    // Total reversed across all ledger entries == credited_total (no double debit).
    const ledgerSum = await sql<{ s: string }>(
      `SELECT COALESCE(sum(amount_coins), 0) AS s FROM rf_coin_ledger
       WHERE reference_id = $1 AND kind = 'chargeback_reversal'`, [topupId]);
    expect(Number(ledgerSum[0].s)).toBe(1000);
  });

  it('execute grants match the permission matrix', async () => {
    const grants = await sql<{ proname: string; grantee: string; privilege_type: string }>(`
      SELECT p.proname, COALESCE(pg_get_userbyid(a.grantor), a.grantee::text) AS grantor_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
             a.privilege_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a ON true
      WHERE n.nspname = 'public' AND p.proname LIKE 'rf_coin_%'
    `);
    const has = (fn: string, role: string, priv = 'EXECUTE') =>
      grants.some((g) => g.proname === fn && g.grantee === role && g.privilege_type === priv);

    // Customer-callable + admin RPCs → authenticated; webhook RPCs → service_role.
    expect(has('rf_coin_create_topup', 'authenticated')).toBe(true);
    expect(has('rf_coin_settle_order_payment', 'authenticated')).toBe(true);
    expect(has('rf_coin_request_adjustment', 'authenticated')).toBe(true);
    expect(has('rf_coin_decide_adjustment', 'authenticated')).toBe(true);
    expect(has('rf_coin_set_settings', 'authenticated')).toBe(true);
    expect(has('rf_coin_upsert_package', 'authenticated')).toBe(true);
    expect(has('rf_coin_credit_paid_topup', 'service_role')).toBe(true);
    expect(has('rf_coin_mark_topup_status', 'service_role')).toBe(true);
    expect(has('rf_coin_release_order_payment', 'service_role')).toBe(true);
    // Nothing granted to PUBLIC; helpers not granted at all.
    for (const g of grants) expect(g.grantee).not.toBe('PUBLIC');
    expect(has('rf_coin_assert_super_admin', 'authenticated')).toBe(false);
    expect(has('rf_coin_assert_super_admin', 'service_role')).toBe(false);
    expect(has('rf_coin_get_settings', 'authenticated')).toBe(false);
  });

  it('webhook RPCs are denied to authenticated even though granted roles differ', async () => {
    await asRole('authenticated', CUSTOMER);
    await expect(sql(`SELECT * FROM rf_coin_credit_paid_topup($1, 'x')`,
      ['00000000-0000-0000-0000-00000000dead']))
      .rejects.toThrow(/permission denied/i);
    await resetRole();
  });

  it('customer settings row is invisible to clients (fail-closed RLS)', async () => {
    await asRole('authenticated', CUSTOMER);
    const rows = await sql(`SELECT * FROM rf_coin_settings`);
    expect(rows.length).toBe(0);
    await resetRole();
  });

  it('ledger is append-only even for the service role', async () => {
    await asRole('service_role');
    await expect(sql(`UPDATE rf_coin_ledger SET amount_coins = 1`))
      .rejects.toThrow(/RF_COIN_LEDGER_IMMUTABLE|permission denied/i);
    await resetRole();
  });

  it('fulfillment handoff: enqueue is idempotent, client-denied, and lease-claimed exactly once', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000001'; // settled earlier (VERIFIED)

    // Client identities are denied the queue RPCs (service role only).
    await asRole('authenticated', CUSTOMER);
    await expect(sql(`SELECT * FROM rf_coin_enqueue_fulfillment($1)`, [orderId]))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    // Service-role enqueue succeeds; a second enqueue is idempotent.
    await asRole('service_role');
    const e1 = await sql<{ out_handoff_id: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_enqueue_fulfillment($1)`, [orderId]);
    expect(e1[0].out_error).toBeNull();
    expect(e1[0].out_handoff_id).toBeTruthy();
    const e2 = await sql<{ out_handoff_id: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_enqueue_fulfillment($1)`, [orderId]);
    await resetRole();
    expect(e2[0].out_error).toBeNull();
    expect(e2[0].out_handoff_id).toBe(e1[0].out_handoff_id);
    const count = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_fulfillment_handoffs WHERE order_id = $1`, [orderId]);
    expect(Number(count[0].n)).toBe(1);

    // Enqueue rejects ineligible orders (wrong method, unpaid, unknown id).
    const wrongMethod = 'aaaaaaaa-0000-0000-0000-000000000002'; // paymongo order
    const enqWrong = await sql<{ out_error: string | null }>(
      `SELECT out_error FROM rf_coin_enqueue_fulfillment($1)`, [wrongMethod]);
    expect(enqWrong[0].out_error).toBe('RF_COIN_ORDER_NOT_ELIGIBLE');
    const enqMissing = await sql<{ out_error: string | null }>(
      `SELECT out_error FROM rf_coin_enqueue_fulfillment($1)`,
      ['eeeeeeee-0000-0000-0000-000000000001']);
    expect(enqMissing[0].out_error).toBe('RF_COIN_ORDER_NOT_FOUND');

    // Claim: worker lease-claims the row exactly once with attempt bump.
    await asRole('service_role');
    const c1 = await sql<{ out_id: string; out_order_id: string; out_attempt_count: number; out_lease_token: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    const mine = c1.find((r) => r.out_order_id === orderId);
    expect(mine).toBeTruthy();
    expect(Number(mine!.out_attempt_count)).toBe(1);
    const c2 = await sql<{ out_id: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    await resetRole();
    expect(c2.find((r) => r.out_id === mine!.out_id)).toBeUndefined(); // no double claim while leased

    // Ack failure schedules a bounded retry; the row returns PENDING.
    await asRole('service_role');
    const f1 = await sql<{ out_status: string; out_next_attempt_at: string | null }>(
      `SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, 'supplier timeout')`,
      [mine!.out_id, mine!.out_lease_token]);
    await resetRole();
    expect(f1[0].out_status).toBe('PENDING');
    expect(f1[0].out_next_attempt_at).toBeTruthy();

    // The row is claimable again after the ack (next_attempt_at passed via
    // direct fixture update to avoid sleeping the test).
    await sql(`UPDATE rf_coin_fulfillment_handoffs SET next_attempt_at = now() - interval '1 second'
               WHERE id = $1`, [mine!.out_id]);
    await asRole('service_role');
    const c3 = await sql<{ out_id: string; out_attempt_count: number }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    const reclaim = c3.find((r) => r.out_id === mine!.out_id);
    expect(reclaim).toBeTruthy();
    expect(Number(reclaim!.out_attempt_count)).toBe(2);

    // Wrong lease token is rejected (lease guard).
    const badAck = await sql<{ out_status: string }>(
      `SELECT out_status FROM rf_coin_ack_fulfillment_handoff($1, $2, 'nope')`,
      [mine!.out_id, '00000000-0000-0000-0000-000000000000']);
    expect(badAck[0].out_status).toBe('rejected');

    // Success ack marks DONE.
    const ack = await sql<{ out_status: string; out_next_attempt_at: string | null }>(
      `SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, NULL)`,
      [mine!.out_id, reclaim!.out_lease_token]);
    await resetRole();
    expect(ack[0].out_status).toBe('DONE');
    const done = await sql<{ status: string }>(
      `SELECT status FROM rf_coin_fulfillment_handoffs WHERE id = $1`, [mine!.out_id]);
    expect(done[0].status).toBe('DONE');

    // DONE rows are never re-claimed.
    await asRole('service_role');
    const c4 = await sql<{ out_id: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    await resetRole();
    expect(c4.find((r) => r.out_id === mine!.out_id)).toBeUndefined();
  });

  it('fulfillment handoff: dead-letters after max attempts and skips unverified orders', async () => {
    // Unverified order is rejected at enqueue time (fail closed).
    const unpaid = 'aaaaaaaa-0000-0000-0000-000000000004';
    await insertOrder({ id: unpaid, userId: CUSTOMER, totalCents: 50000, paymentStatus: 'UNPAID' });
    await sql(`UPDATE orders SET status = 'PAYMENT_VERIFIED' WHERE id = $1`, [unpaid]);
    const enqRejected = await sql<{ out_error: string | null }>(
      `SELECT out_error FROM rf_coin_enqueue_fulfillment($1)`, [unpaid]);
    expect(enqRejected[0].out_error).toBe('RF_COIN_ORDER_NOT_ELIGIBLE');

    // Claim-time precondition: a handoff enqueued while VERIFIED whose order
    // later loses verification is never claimed.
    const preEnqueued = 'aaaaaaaa-0000-0000-0000-000000000006';
    await insertOrder({ id: preEnqueued, userId: CUSTOMER, totalCents: 50000 });
    await sql(`UPDATE orders SET status = 'PAYMENT_VERIFIED', payment_status = 'VERIFIED' WHERE id = $1`, [preEnqueued]);
    const enqPre = await sql<{ out_handoff_id: string }>(
      `SELECT out_handoff_id FROM rf_coin_enqueue_fulfillment($1)`, [preEnqueued]);
    await sql(`UPDATE orders SET payment_status = 'UNPAID' WHERE id = $1`, [preEnqueued]);
    const claimedSkipped = await sql<{ out_id: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(100, 300)`);
    expect(claimedSkipped.find((r) => r.out_id === enqPre[0].out_handoff_id)).toBeUndefined();

    // Bounded retries: exhaust attempts -> DEAD_LETTER, never re-claimed.
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000005';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await sql(`UPDATE orders SET status = 'PAYMENT_VERIFIED', payment_status = 'VERIFIED' WHERE id = $1`, [orderId]);
    const enq2 = await sql<{ out_handoff_id: string }>(
      `SELECT out_handoff_id FROM rf_coin_enqueue_fulfillment($1)`, [orderId]);
    const handoffId = enq2[0].out_handoff_id;

    for (let attempt = 1; attempt <= 5; attempt++) {
      const c = await sql<{ out_id: string; out_lease_token: string; out_status: string }>(
        `SELECT out_id, out_lease_token, out_status FROM rf_coin_claim_fulfillment_handoffs(100, 300)
         WHERE out_id = $1`, [handoffId]);
      if (c.length === 0) break;
      await sql(`SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, 'still failing')`,
        [handoffId, c[0].out_lease_token]);
      // Backdate so the next attempt is immediately claimable.
      await sql(`UPDATE rf_coin_fulfillment_handoffs SET next_attempt_at = now() - interval '1 second'
                 WHERE id = $1 AND status = 'PENDING'`, [handoffId]);
    }
    const final = await sql<{ status: string; attempt_count: number; max_attempts: number }>(
      `SELECT status, attempt_count, max_attempts FROM rf_coin_fulfillment_handoffs WHERE id = $1`,
      [handoffId]);
    expect(final[0].status).toBe('DEAD_LETTER');
    expect(Number(final[0].attempt_count)).toBe(5);

    const reclaimed = await sql<{ out_id: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(100, 300)`);
    expect(reclaimed.find((r) => r.out_id === handoffId)).toBeUndefined();
  });
});

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
const adminCenterSql = readFileSync(join(projectRoot, 'supabase/migrations-pending/20261018160200_rf_coin_admin_center_read.sql'), 'utf8');

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
  await db.exec(adminCenterSql);

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
  it('keeps funding and spending locked even when database settings are switched on', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-0000000000f1';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER, 1000);
    const activePackage = await sql<{ id: string }>(`SELECT id FROM rf_coin_packages LIMIT 1`);

    await asRole('authenticated', CUSTOMER);
    const topup = await sql<{ out_error: string }>(
      `SELECT * FROM rf_coin_create_topup($1, $2)`, [CUSTOMER, activePackage[0].id]);
    const spending = await sql<{ out_error: string }>(
      `SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
    expect(topup[0].out_error).toBe('RF_COIN_FUNDING_RELEASE_LOCKED');
    expect(spending[0].out_error).toBe('RF_COIN_SPENDING_RELEASE_LOCKED');
    await resetRole();

    const [pending] = await sql<{ id: string }>(
      `INSERT INTO rf_coin_topups (user_id, package_id, coins, bonus_coins, price_cents, provider_reference, idempotency_key)
       VALUES ($1, $2, 100, 10, 10000, 'release-lock-provider-reference', 'release-lock-topup') RETURNING id`,
      [CUSTOMER, activePackage[0].id]);
    await asRole('service_role');
    const creditAttempt = await sql<{ out_credited: boolean; out_error: string }>(
      `SELECT * FROM rf_coin_credit_paid_topup($1, 'release-lock-provider-reference')`, [pending.id]);
    await resetRole();
    expect(creditAttempt[0].out_credited).toBe(false);
    expect(creditAttempt[0].out_error).toBe('RF_COIN_FUNDING_RELEASE_LOCKED');

    const order = await sql<{ status: string }>(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    const wallet = await sql<{ balance_coins: string }>(`SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER]);
    const topupState = await sql<{ status: string; credited_at: string | null }>(
      `SELECT status, credited_at FROM rf_coin_topups WHERE id = $1`, [pending.id]);
    expect(order[0].status).toBe('WAITING_PAYMENT');
    expect(Number(wallet[0].balance_coins)).toBe(1000);
    expect(topupState[0]).toEqual({ status: 'PENDING', credited_at: null });
    await createWallet(CUSTOMER, 0);

    // Remaining accounting tests intentionally unlock only the disposable
    // in-process database to exercise future release mechanics.
    const sandboxFunctions = functionsSql
      .replaceAll('v_funding_release_enabled CONSTANT boolean := false', 'v_funding_release_enabled CONSTANT boolean := true')
      .replaceAll('v_spending_release_enabled CONSTANT boolean := false', 'v_spending_release_enabled CONSTANT boolean := true');
    await db.exec(sandboxFunctions);
  });

  it('package creation stays inactive; activation is explicit and top-up snapshots survive package edits', async () => {
    await asRole('authenticated', SUPER_ADMIN);
    const created = await sql<{ rf_coin_upsert_package: string }>(
      `SELECT rf_coin_upsert_package(NULL, 'Disposable bundle', 500, 50, 25000, true, 9)`);
    const packageId = created[0].rf_coin_upsert_package;
    await resetRole();
    const [inactive] = await sql<{ is_active: boolean }>(`SELECT is_active FROM rf_coin_packages WHERE id = $1`, [packageId]);
    expect(inactive.is_active).toBe(false);

    await asRole('authenticated', CUSTOMER);
    const unavailable = await sql<{ out_topup_id: string | null; out_error: string }>(
      `SELECT * FROM rf_coin_create_topup($1, $2)`, [CUSTOMER, packageId]);
    await resetRole();
    expect(unavailable[0].out_topup_id).toBeNull();
    expect(unavailable[0].out_error).toBe('RF_COIN_PACKAGE_UNAVAILABLE');

    await asRole('authenticated', SUPER_ADMIN);
    await sql(`SELECT rf_coin_upsert_package($1, NULL, NULL, NULL, NULL, true, NULL)`, [packageId]);
    await resetRole();
    await asRole('authenticated', CUSTOMER);
    const purchase = await sql<{ out_topup_id: string; out_coins: number; out_bonus_coins: number; out_price_cents: number }>(
      `SELECT * FROM rf_coin_create_topup($1, $2)`, [CUSTOMER, packageId]);
    await resetRole();
    expect(purchase[0]).toMatchObject({ out_coins: 500, out_bonus_coins: 50, out_price_cents: 25000 });

    await asRole('authenticated', SUPER_ADMIN);
    await sql(`SELECT rf_coin_upsert_package($1, 'Updated bundle', 900, 100, 45000, NULL, 10)`, [packageId]);
    await resetRole();
    const [snapshot] = await sql<{ coins: number; bonus_coins: number; price_cents: number }>(
      `SELECT coins, bonus_coins, price_cents FROM rf_coin_topups WHERE id = $1`, [purchase[0].out_topup_id]);
    expect(snapshot).toEqual({ coins: 500, bonus_coins: 50, price_cents: 25000 });
  });

  it('admin credits work: low-value credit applies immediately with audit + ledger', async () => {
    await asRole('authenticated', SUPER_ADMIN);
    const res = await sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 100, 'goodwill gesture here', 'promotion', 'test-adjustment-idempotency-1')`,
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

  it('high-value adjustments require a distinct Super Admin and idempotency payloads cannot change', async () => {
    const key = 'high-value-adjustment-idempotency-001';
    await asRole('authenticated', SUPER_ADMIN);
    const requested = await sql<{ out_request_id: string; out_status: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_request_adjustment($1, 'credit', 5000, 'approved test adjustment', 'compensation', $2)`,
      [CUSTOMER2, key]);
    const retried = await sql<{ out_request_id: string; out_status: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_request_adjustment($1, 'credit', 5000, 'approved test adjustment', 'compensation', $2)`,
      [CUSTOMER2, key]);
    const keyConflict = await sql<{ out_error: string | null }>(
      `SELECT * FROM rf_coin_request_adjustment($1, 'credit', 5001, 'approved test adjustment', 'compensation', $2)`,
      [CUSTOMER2, key]);
    const selfApproval = await sql<{ out_error: string | null }>(
      `SELECT * FROM rf_coin_decide_adjustment($1, true, 'self approval attempt')`, [requested[0].out_request_id]);
    expect(requested[0].out_status).toBe('PENDING');
    expect(retried[0].out_request_id).toBe(requested[0].out_request_id);
    expect(keyConflict[0].out_error).toBe('RF_COIN_IDEMPOTENCY_CONFLICT');
    expect(selfApproval[0].out_error).toBe('RF_COIN_SECOND_ADMIN_REQUIRED');
    await resetRole();

    const SECOND_SUPER_ADMIN = '33333333-3333-4333-8333-333333333334';
    await sql(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, 'super2@example.invalid', now())`, [SECOND_SUPER_ADMIN]);
    await sql(`INSERT INTO admins (id, email, name, role, is_active) VALUES ($1, 'super2@example.invalid', 'Second Super', 'SUPER_ADMIN', true)`, [SECOND_SUPER_ADMIN]);
    await asRole('authenticated', SECOND_SUPER_ADMIN);
    const approved = await sql<{ out_status: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_decide_adjustment($1, true, 'independent approval')`, [requested[0].out_request_id]);
    await resetRole();
    expect(approved[0].out_status).toBe('APPLIED');
    expect(approved[0].out_error).toBeNull();
    const record = await sql<{ status: string; requested_by: string; approved_by: string }>(
      `SELECT status, requested_by, approved_by FROM rf_coin_adjustment_requests WHERE id = $1`, [requested[0].out_request_id]);
    expect(record[0].status).toBe('APPLIED');
    expect(record[0].approved_by).not.toBe(record[0].requested_by);
  });

  it('regular admin and anon cannot run admin RPCs', async () => {
    await asRole('authenticated', REGULAR_ADMIN);
    const res = await sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 5, 'not allowed here', 'promotion', 'test-adjustment-idempotency-2')`, [CUSTOMER]);
    expect(res[0].out_error).toBe('RF_COIN_FORBIDDEN');
    await resetRole();

    await asRole('anon');
    await expect(sql(`SELECT * FROM rf_coin_request_adjustment(
      $1, 'credit', 5, 'not allowed here', 'promotion', 'test-adjustment-idempotency-3')`, [CUSTOMER]))
      .rejects.toThrow(/permission denied|rf_coin_request_adjustment/i);
    await resetRole();
  });

  it('admin center reporting is Super Admin-only, bounded, searchable, and uses exact aggregates', async () => {
    const REPORT_CUSTOMER = '77777777-7777-4777-8777-777777777777';
    await sql(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, 'report@example.invalid', now())`, [REPORT_CUSTOMER]);
    await createWallet(REPORT_CUSTOMER, 25);
    // A wallet without a corresponding ledger history is surfaced as a
    // reconciliation exception rather than silently treated as consistent.
    await createWallet(CUSTOMER2, 7);
    await sql(`UPDATE rf_coin_wallets SET total_purchased_coins = 80, total_spent_coins = 55,
      total_manual_credited_coins = 10, total_manual_debited_coins = 5 WHERE user_id = $1`, [REPORT_CUSTOMER]);
    await sql(`INSERT INTO rf_coin_ledger (wallet_user_id, direction, amount_coins, kind,
      balance_after, reason, actor_type, idempotency_key)
      VALUES ($1, 'credit', 80, 'topup_purchase', 80, 'synthetic test purchase', 'system', 'report-ledger-1'),
        ($1, 'debit', 55, 'order_payment', 25, 'synthetic test spend', 'customer', 'report-ledger-2')`, [REPORT_CUSTOMER]);
    await sql(`INSERT INTO rf_coin_topups (user_id, coins, price_cents, status, idempotency_key)
      VALUES ($1, 100, 2500, 'PENDING', 'report-topup-pending'),
        ($1, 20, 500, 'FAILED', 'report-topup-failed')`, [REPORT_CUSTOMER]);

    const expectedRows = await sql<{ wallets: string; outstanding: string; purchased: string; spent: string; pending: string; pending_cents: string; failed_expired: string; discrepancies: string }>(
      `SELECT (SELECT count(*) FROM rf_coin_wallets) AS wallets,
        (SELECT coalesce(sum(balance_coins), 0) FROM rf_coin_wallets) AS outstanding,
        (SELECT coalesce(sum(total_purchased_coins), 0) FROM rf_coin_wallets) AS purchased,
        (SELECT coalesce(sum(amount_coins), 0) FROM rf_coin_ledger WHERE kind = 'order_payment') AS spent,
        (SELECT count(*) FROM rf_coin_topups WHERE status = 'PENDING') AS pending,
        (SELECT coalesce(sum(price_cents), 0) FROM rf_coin_topups WHERE status = 'PENDING') AS pending_cents,
        (SELECT count(*) FROM rf_coin_topups WHERE status IN ('FAILED','EXPIRED')) AS failed_expired,
        (SELECT count(*) FROM rf_coin_wallets w
          LEFT JOIN (SELECT wallet_user_id, sum(CASE WHEN direction = 'credit' THEN amount_coins ELSE -amount_coins END) AS balance
            FROM rf_coin_ledger GROUP BY wallet_user_id) l ON l.wallet_user_id = w.user_id
          WHERE w.balance_coins <> coalesce(l.balance, 0)) AS discrepancies`);

    await asRole('authenticated', SUPER_ADMIN);
    const result = await sql<{ report: Record<string, unknown> }>(
      `SELECT rf_coin_admin_center_read('report@example.invalid', 1, 1, NULL, now() - interval '7 days', now()) AS report`);
    const report = result[0].report as Record<string, unknown>;
    const metrics = report.metrics as Record<string, string>;
    const wallets = report.wallets as { total: number; rows: Array<{ user_id: string }> };
    const exceptions = report.exceptions as { total: string; rows: Array<{ category: string }> };
    expect(metrics.outstanding).toBe(String(expectedRows[0].outstanding));
    expect(metrics.walletCount).toBe(String(expectedRows[0].wallets));
    expect(metrics.purchased).toBe(String(expectedRows[0].purchased));
    expect(metrics.spent).toBe(String(expectedRows[0].spent));
    expect(metrics.pendingTopups).toBe(String(expectedRows[0].pending));
    expect(metrics.pendingTopupCents).toBe(String(expectedRows[0].pending_cents));
    expect(metrics.failedExpiredTopups).toBe(String(expectedRows[0].failed_expired));
    expect(Number(metrics.ledgerBalanceDiscrepancies)).toBe(Number(expectedRows[0].discrepancies));
    expect(Number(metrics.ledgerBalanceDiscrepancies)).toBeGreaterThanOrEqual(1);
    expect(metrics.unresolvedExceptions).toBe(exceptions.total);
    expect(Number(exceptions.total)).toBe(2);
    const allExceptionsResult = await sql<{ report: Record<string, unknown> }>(
      `SELECT rf_coin_admin_center_read(NULL, 1, 50, NULL, now() - interval '7 days', now()) AS report`);
    const allExceptions = (allExceptionsResult[0].report.exceptions as { rows: Array<{ category: string }> }).rows;
    expect(allExceptions.map((item) => item.category)).toContain('wallet_ledger_mismatch');
    expect(allExceptions.map((item) => item.category)).toContain('unusual_manual_adjustment');
    expect(wallets.total).toBe(1);
    expect(wallets.rows).toHaveLength(1);
    expect(report.fundingReleaseEnabled).toBe(false);
    const filtered = await sql<{ report: Record<string, unknown> }>(
      `SELECT rf_coin_admin_center_read('report@example.invalid', 1, 1, NULL, now() - interval '7 days', now(), 'PENDING', 'all') AS report`);
    const filteredReport = filtered[0].report;
    const filteredTopups = filteredReport.topups as { total: number; rows: Array<{ status: string }> };
    expect(filteredTopups.total).toBe(1);
    expect(filteredTopups.rows[0].status).toBe('PENDING');
    const providerFiltered = await sql<{ report: Record<string, unknown> }>(
      `SELECT rf_coin_admin_center_read('report@example.invalid', 1, 1, NULL, now() - interval '7 days', now(), 'PENDING', 'all', 'manual') AS report`);
    expect((providerFiltered[0].report.topups as { total: number }).total).toBe(0);
    const zeroBalanceFilter = await sql<{ report: Record<string, unknown> }>(
      `SELECT rf_coin_admin_center_read('report@example.invalid', 1, 1, NULL, now() - interval '7 days', now(), NULL, 'zero') AS report`);
    expect((zeroBalanceFilter[0].report.wallets as { total: number }).total).toBe(0);
    await resetRole();

    await asRole('authenticated', REGULAR_ADMIN);
    await expect(sql(`SELECT rf_coin_admin_center_read(NULL, 1, 50, NULL, now() - interval '1 day', now())`))
      .rejects.toThrow(/RF_COIN_FORBIDDEN/);
    await resetRole();

    await asRole('anon');
    await expect(sql(`SELECT rf_coin_admin_center_read(NULL, 1, 50, NULL, now() - interval '1 day', now())`))
      .rejects.toThrow(/permission denied/i);
    await resetRole();
  });

  it('records exports in the append-only audit using metadata only and denies other roles', async () => {
    await asRole('authenticated', SUPER_ADMIN);
    await sql(`SELECT rf_coin_record_admin_export('wallets', 0, now() - interval '1 day', now())`);
    await resetRole();
    const audit = await sql<{ entity_id: string; details: Record<string, unknown> }>(
      `SELECT entity_id, details FROM rf_coin_admin_audit WHERE action = 'report_export' ORDER BY created_at DESC LIMIT 1`);
    expect(audit[0].entity_id).toBe('wallets');
    expect(audit[0].details).toMatchObject({ row_count: 0, format: 'csv' });
    expect(JSON.stringify(audit[0].details)).not.toMatch(/email|provider_reference|payload|credential/i);

    await asRole('authenticated', REGULAR_ADMIN);
    await expect(sql(`SELECT rf_coin_record_admin_export('wallets', 0, now() - interval '1 day', now())`))
      .rejects.toThrow(/RF_COIN_FORBIDDEN/);
    await resetRole();
    await asRole('anon');
    await expect(sql(`SELECT rf_coin_record_admin_export('wallets', 0, now() - interval '1 day', now())`))
      .rejects.toThrow(/permission denied/i);
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
      $1, 'credit', 5, 'suspended admin denied', 'promotion', 'test-adjustment-idempotency-suspended')`, [CUSTOMER]);
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
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`,
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
    const res2 = await sql(`SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
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
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
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
    const res = await sql(`SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER2]);
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
    const retried = await sql<{ out_topup_id: string; out_error: string | null }>(
      `SELECT * FROM rf_coin_create_topup($1, $2)`, [CUSTOMER, pkg[0].id]);
    expect(retried[0].out_error).toBeNull();
    expect(retried[0].out_topup_id).toBe(topupId);
    await resetRole();

    await sql(`UPDATE rf_coin_topups SET provider_reference = 'pay-ref-1' WHERE id = $1`, [topupId]);
    await asRole('service_role');
    const mismatched = await sql<{ out_error: string | null }>(
      `SELECT * FROM rf_coin_credit_paid_topup($1, 'different-payment')`, [topupId]);
    expect(mismatched[0].out_error).toBe('RF_COIN_PROVIDER_REFERENCE_MISMATCH');
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
    const verification = await sql<{ payment_verified_at: string | null; credited_at: string | null }>(
      `SELECT payment_verified_at, credited_at FROM rf_coin_topups WHERE id = $1`, [topupId]);
    expect(verification[0].payment_verified_at).toBeTruthy();
    expect(verification[0].credited_at).toBeTruthy();
  });

  it('partial refund reversal debits bounded, never double-debits, and stays pending', async () => {
    // Customer2: credited 1000 (900 + 100 bonus), spends 900, wallet has 100.
    await createWallet(CUSTOMER2, 100);
    const topup = await sql<{ id: string; credited_total: string }>(
      `INSERT INTO rf_coin_topups (user_id, package_id, coins, bonus_coins, price_cents,
         status, idempotency_key, provider_reference, credited_at, credited_total)
       VALUES ($1, NULL, 900, 100, 90000, 'PAID', 'test-reversal-topup-1', 'ref-1', now(), 1000)
       RETURNING id, credited_total`, [CUSTOMER2]);
    const topupId = topup[0].id;
    expect(Number(topup[0].credited_total)).toBe(1000);

    await asRole('service_role');
    const wrongRef = await sql<{ out_error: string | null }>(
      `SELECT * FROM rf_coin_mark_topup_status($1, 'REFUNDED', 'other-ref')`, [topupId]);
    expect(wrongRef[0].out_error).toBe('RF_COIN_PROVIDER_REFERENCE_MISMATCH');
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
    expect(has('rf_coin_get_or_create_wallet', 'authenticated')).toBe(true);
    expect(has('rf_coin_create_topup', 'authenticated')).toBe(true);
    // Legacy direct settlement is locked down: only the atomic wrapper is
    // customer-callable, so settlement can never bypass the handoff enqueue.
    expect(has('rf_coin_settle_order_payment', 'authenticated')).toBe(false);
    expect(has('rf_coin_settle_order_payment_and_enqueue', 'authenticated')).toBe(true);
    expect(has('rf_coin_request_adjustment', 'authenticated')).toBe(true);
    expect(has('rf_coin_decide_adjustment', 'authenticated')).toBe(true);
    expect(has('rf_coin_set_settings', 'authenticated')).toBe(true);
    expect(has('rf_coin_upsert_package', 'authenticated')).toBe(true);
    expect(has('rf_coin_admin_center_read', 'authenticated')).toBe(true);
    expect(has('rf_coin_record_admin_export', 'authenticated')).toBe(true);
    expect(has('rf_coin_credit_paid_topup', 'service_role')).toBe(true);
    expect(has('rf_coin_mark_topup_status', 'service_role')).toBe(true);
    expect(has('rf_coin_release_order_payment', 'service_role')).toBe(true);
    // Nothing is granted to PUBLIC; only the caller-scoped wallet initializer
    // is exposed to authenticated customers, and internal helpers stay private.
    for (const g of grants) expect(g.grantee).not.toBe('PUBLIC');
    expect(has('rf_coin_assert_super_admin', 'authenticated')).toBe(false);
    expect(has('rf_coin_assert_super_admin', 'service_role')).toBe(false);
    expect(has('rf_coin_get_or_create_wallet', 'anon')).toBe(false);
    expect(has('rf_coin_get_or_create_wallet', 'service_role')).toBe(false);
    expect(has('rf_coin_get_settings', 'authenticated')).toBe(false);
    expect(has('rf_coin_admin_center_read', 'anon')).toBe(false);
    expect(has('rf_coin_record_admin_export', 'anon')).toBe(false);
    // Legacy settlement is not executable by any client or service identity.
    expect(has('rf_coin_settle_order_payment', 'anon')).toBe(false);
    expect(has('rf_coin_settle_order_payment', 'service_role')).toBe(false);
  });

  it('initializes only the authenticated caller wallet at a genuine zero balance', async () => {
    const INITIALIZED_CUSTOMER = '77777777-7777-7777-7777-777777777701';
    await sql(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, 'new-wallet@example.invalid', now())`, [INITIALIZED_CUSTOMER]);
    await asRole('authenticated', INITIALIZED_CUSTOMER);
    const initial = await sql<{ user_id: string; balance_coins: string }>(
      'SELECT user_id, balance_coins FROM rf_coin_get_or_create_wallet($1)', [INITIALIZED_CUSTOMER],
    );
    expect(Number(initial[0].balance_coins)).toBe(0);
    expect(initial[0].user_id).toBe(INITIALIZED_CUSTOMER);
    const customerApiRows = await sql<{ user_id: string; balance_coins: number }>(
      `SELECT user_id, balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [INITIALIZED_CUSTOMER]);
    expect(customerApiRows).toEqual([{ user_id: INITIALIZED_CUSTOMER, balance_coins: 0 }]);

    const repeated = await sql<{ user_id: string; balance_coins: string }>(
      'SELECT user_id, balance_coins FROM rf_coin_get_or_create_wallet($1)', [INITIALIZED_CUSTOMER],
    );
    expect(Number(repeated[0].balance_coins)).toBe(0);
    expect(repeated[0].user_id).toBe(INITIALIZED_CUSTOMER);
    await expect(sql('SELECT * FROM rf_coin_get_or_create_wallet($1)', [CUSTOMER2]))
      .rejects.toThrow(/RF_COIN_FORBIDDEN/);
    await resetRole();

    await asRole('authenticated', CUSTOMER2);
    const otherCustomerRows = await sql<{ user_id: string }>(
      `SELECT user_id FROM rf_coin_wallets WHERE user_id = $1`, [INITIALIZED_CUSTOMER]);
    expect(otherCustomerRows).toHaveLength(0);
    await resetRole();

    await asRole('anon');
    await expect(sql('SELECT * FROM rf_coin_get_or_create_wallet($1)', [CUSTOMER]))
      .rejects.toThrow(/permission denied/i);
    await resetRole();
  });

  it('webhook RPCs are denied to authenticated even though granted roles differ', async () => {
    await asRole('authenticated', CUSTOMER);
    await expect(sql(`SELECT * FROM rf_coin_credit_paid_topup($1, 'x')`,
      ['00000000-0000-0000-0000-00000000dead']))
      .rejects.toThrow(/permission denied/i);
    await resetRole();
  });

  it('legacy direct settlement RPC is blocked for every client identity (Codex fix 1)', async () => {
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000020';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER, 1000);

    // Authenticated customers can no longer call the legacy settlement RPC.
    await asRole('authenticated', CUSTOMER);
    await expect(sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER]))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    // Anon and service_role are also denied.
    await asRole('anon');
    await expect(sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER]))
      .rejects.toThrow(/permission denied/i);
    await resetRole();
    await asRole('service_role');
    await expect(sql(`SELECT * FROM rf_coin_settle_order_payment($1, $2)`, [orderId, CUSTOMER]))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    // No debit, no verification, no handoff: nothing moved.
    const order = await sql<{ status: string; payment_status: string }>(
      `SELECT status, payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(order[0].status).toBe('WAITING_PAYMENT');
    expect(order[0].payment_status).toBe('UNPAID');
    const bal = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER]);
    expect(Number(bal[0].balance_coins)).toBe(1000);
    const handoffs = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_fulfillment_handoffs WHERE order_id = $1`, [orderId]);
    expect(Number(handoffs[0].n)).toBe(0);
  });

  it('atomic settle+enqueue wrapper works and always produces the handoff (Codex fix 1)', async () => {
    // The only customer settlement path: debits, verifies, and enqueues in
    // ONE transaction — no settlement without its fulfillment handoff.
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000021';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER, 1000);

    await asRole('authenticated', CUSTOMER);
    const res = await sql<{ out_coins: number; out_balance_after: string; out_handoff_id: string | null; out_error: string | null }>(
      `SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
    await resetRole();
    expect(res[0].out_error).toBeNull();
    expect(res[0].out_coins).toBe(500);
    expect(res[0].out_handoff_id).toBeTruthy();

    const order = await sql<{ status: string; payment_status: string }>(
      `SELECT status, payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(order[0].status).toBe('PAYMENT_VERIFIED');
    expect(order[0].payment_status).toBe('VERIFIED');
    const handoffs = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_fulfillment_handoffs WHERE order_id = $1`, [orderId]);
    expect(Number(handoffs[0].n)).toBe(1);
  });

  it('cron trigger is executable by postgres only (Codex fix 2)', async () => {
    await asRole('authenticated', CUSTOMER);
    await expect(sql(`SELECT public.trigger_fulfillment_handoff()`))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    await asRole('anon');
    await expect(sql(`SELECT public.trigger_fulfillment_handoff()`))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    // postgres retains execution; it performs no HTTP call because no secret
    // row exists (the trigger returns early with a NOTICE).
    await db.exec(`SET ROLE postgres`);
    await sql(`SELECT public.trigger_fulfillment_handoff()`);
    await db.exec(`RESET ROLE`);
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
    const c3 = await sql<{ out_id: string; out_attempt_count: number; out_lease_token: string }>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    const reclaim = c3.find((r) => r.out_id === mine!.out_id);
    expect(reclaim).toBeTruthy();
    expect(Number(reclaim!.out_attempt_count)).toBe(2);
    const reclaimToken = reclaim!.out_lease_token;

    // Wrong lease token is rejected (lease guard).
    const badAck = await sql<{ out_status: string }>(
      `SELECT out_status FROM rf_coin_ack_fulfillment_handoff($1, $2, 'nope')`,
      [mine!.out_id, '00000000-0000-0000-0000-000000000000']);
    expect(badAck[0].out_status).toBe('rejected');

    // Success ack marks DONE.
    const ack = await sql<{ out_status: string; out_next_attempt_at: string | null }>(
      `SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, NULL)`,
      [mine!.out_id, reclaimToken]);
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
      const c = await sql<{ out_id: string; out_lease_token: string }>(
        `SELECT out_id, out_lease_token FROM rf_coin_claim_fulfillment_handoffs(100, 300)
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

  it('atomic settle+enqueue: paid order always has a queued fulfillment, crash-safe', async () => {
    // The combined RPC debits the wallet, verifies payment, and enqueues the
    // durable fulfillment handoff inside ONE transaction.
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000010';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await createWallet(CUSTOMER, 1000); // 500 coins needed

    await asRole('authenticated', CUSTOMER);
    const res = await sql<{ out_coins: number; out_balance_after: string; out_handoff_id: string | null; out_error: string | null }>(
      `SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
    expect(res[0].out_error).toBeNull();
    expect(res[0].out_coins).toBe(500);
    expect(String(res[0].out_balance_after)).toBe('500');
    expect(res[0].out_handoff_id).toBeTruthy();
    await resetRole();

    // Wallet debited once, order verified, exactly one handoff row exists.
    const bal = await sql<{ balance_coins: string }>(
      `SELECT balance_coins FROM rf_coin_wallets WHERE user_id = $1`, [CUSTOMER]);
    expect(Number(bal[0].balance_coins)).toBe(500);
    const order = await sql<{ status: string; payment_status: string }>(
      `SELECT status, payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(order[0].status).toBe('PAYMENT_VERIFIED');
    expect(order[0].payment_status).toBe('VERIFIED');
    const handoffs = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_fulfillment_handoffs WHERE order_id = $1`, [orderId]);
    expect(Number(handoffs[0].n)).toBe(1);

    // Idempotent retry (e.g. client retry after a dropped response) returns
    // the same handoff without a second debit.
    await asRole('authenticated', CUSTOMER);
    const res2 = await sql<{ out_coins: number; out_handoff_id: string | null; out_error: string | null }>(
      `SELECT * FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [orderId, CUSTOMER]);
    await resetRole();
    expect(res2[0].out_error).toBeNull();
    expect(res2[0].out_coins).toBe(500);
    expect(res2[0].out_handoff_id).toBe(res[0].out_handoff_id);
    const ledgerCount = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_ledger WHERE reference_id = $1 AND kind = 'order_payment'`, [orderId]);
    expect(Number(ledgerCount[0].n)).toBe(1);

    // Failure path: a wallet that cannot cover the order rolls the whole
    // settlement back — order stays unpaid, no handoff row, coins untouched.
    const poorOrder = 'aaaaaaaa-0000-0000-0000-000000000011';
    await insertOrder({ id: poorOrder, userId: CUSTOMER2, totalCents: 50000 });
    await createWallet(CUSTOMER2, 10); // 500 needed, 10 available
    await asRole('authenticated', CUSTOMER2);
    const resFail = await sql<{ out_error: string | null }>(
      `SELECT out_error FROM rf_coin_settle_order_payment_and_enqueue($1, $2)`, [poorOrder, CUSTOMER2]);
    await resetRole();
    expect(resFail[0].out_error).toBe('RF_COIN_INSUFFICIENT_BALANCE');
    const poorOrderRow = await sql<{ status: string; payment_status: string }>(
      `SELECT status, payment_status FROM orders WHERE id = $1`, [poorOrder]);
    expect(poorOrderRow[0].status).toBe('WAITING_PAYMENT');
    expect(poorOrderRow[0].payment_status).toBe('UNPAID');
    const poorHandoffs = await sql<{ n: string }>(
      `SELECT count(*) AS n FROM rf_coin_fulfillment_handoffs WHERE order_id = $1`, [poorOrder]);
    expect(Number(poorHandoffs[0].n)).toBe(0);
  });

  it('worker response contract: claim + ack return exactly the out_* fields the worker reads', async () => {
    // Mirror of supabase/functions/fulfillment-handoff/index.ts: the worker
    // reads out_id, out_order_id, out_lease_token from claim, and out_status
    // from ack. Renaming any of these columns must fail this test.
    const orderId = 'aaaaaaaa-0000-0000-0000-000000000012';
    await insertOrder({ id: orderId, userId: CUSTOMER, totalCents: 50000 });
    await sql(`UPDATE orders SET status = 'PAYMENT_VERIFIED', payment_status = 'VERIFIED' WHERE id = $1`, [orderId]);
    await asRole('service_role');
    const enq = await sql<{ out_handoff_id: string }>(
      `SELECT out_handoff_id FROM rf_coin_enqueue_fulfillment($1)`, [orderId]);
    const handoffId = enq[0].out_handoff_id;

    const claimed = await sql<Record<string, unknown>>(
      `SELECT * FROM rf_coin_claim_fulfillment_handoffs(10, 300)`);
    const mine = claimed.find((r) => r.out_id === handoffId) as Record<string, unknown> | undefined;
    await resetRole();
    expect(mine).toBeTruthy();
    // Exact column names the worker dereferences after db.rpc(...)
    expect(Object.keys(mine!)).toEqual(
      expect.arrayContaining(['out_id', 'out_order_id', 'out_lease_token', 'out_attempt_count', 'out_lease_until']));
    expect(typeof mine!.out_lease_token).toBe('string');

    // Ack returns out_status ('DONE' on success, 'rejected' on a bad lease).
    await asRole('service_role');
    const ack = await sql<{ out_status: string }>(
      `SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, NULL)`,
      [mine!.out_id, mine!.out_lease_token]);
    const badAck = await sql<{ out_status: string }>(
      `SELECT * FROM rf_coin_ack_fulfillment_handoff($1, $2, 'err')`,
      [mine!.out_id, '00000000-0000-0000-0000-000000000000']);
    await resetRole();
    expect(ack[0].out_status).toBe('DONE');
    expect(badAck[0].out_status).toBe('rejected');
  });
});

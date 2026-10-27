import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261027110000_grant_public_catalog_columns.sql'),
  'utf8',
);

const CUSTOMER_A = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_B = '22222222-2222-4222-8222-222222222222';
const ACTIVE_GAME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INACTIVE_GAME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTIVE_PACKAGE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INACTIVE_PACKAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PRIVATE_PACKAGE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db: PGlite;

async function asRole(role: 'anon' | 'authenticated', userId?: string) {
  await db.exec('RESET ROLE');
  await db.exec(`SELECT set_config('request.jwt.claims', '${JSON.stringify({ role, ...(userId ? { sub: userId } : {}) })}', false)`);
  await db.exec(`SET ROLE ${role}`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
    $$;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;

    CREATE TABLE public.games (
      id uuid PRIMARY KEY,
      slug text NOT NULL,
      name text NOT NULL,
      short_name text,
      description text NOT NULL,
      region text NOT NULL,
      currency text NOT NULL,
      logo_url text,
      cover_url text,
      banner_url text,
      is_active boolean NOT NULL,
      is_featured boolean NOT NULL,
      sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.packages (
      id uuid PRIMARY KEY,
      game_id uuid NOT NULL REFERENCES public.games(id),
      name text NOT NULL,
      sku text NOT NULL,
      amount text NOT NULL,
      price_cents integer NOT NULL,
      original_price_cents integer,
      bonus text,
      is_active boolean NOT NULL,
      sort_order integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      badge text,
      image_url text,
      supplier_offer_id text,
      supplier_category_id text,
      supplier_cost_usd numeric(10,4),
      markup_percent numeric(10,2)
    );
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY,
      customer_user_id uuid NOT NULL,
      game_id uuid NOT NULL REFERENCES public.games(id),
      package_id uuid NOT NULL REFERENCES public.packages(id),
      reference text NOT NULL
    );

    ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY public_read_active_games ON public.games
      FOR SELECT TO anon, authenticated USING (is_active IS TRUE);
    CREATE POLICY public_read_active_packages ON public.packages
      FOR SELECT TO anon, authenticated USING (
        is_active IS TRUE AND EXISTS (
          SELECT 1 FROM public.games g WHERE g.id = packages.game_id AND g.is_active IS TRUE
        )
      );
    CREATE POLICY customer_reads_own_orders ON public.orders
      FOR SELECT TO authenticated USING (customer_user_id = auth.uid());
    GRANT SELECT ON public.orders TO authenticated;
  `);

  await db.exec(migration);
  await db.exec(`
    INSERT INTO public.games (id, slug, name, short_name, description, region, currency, is_active, is_featured, sort_order)
    VALUES
      ('${ACTIVE_GAME}', 'active', 'Active Game', 'ACT', 'Public description', 'Global', 'PHP', true, true, 1),
      ('${INACTIVE_GAME}', 'inactive', 'Inactive Game', 'INA', 'Hidden description', 'Global', 'PHP', false, false, 2);
    INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, original_price_cents, is_active, sort_order, supplier_offer_id, supplier_category_id, supplier_cost_usd, markup_percent)
    VALUES
      ('${ACTIVE_PACKAGE}', '${ACTIVE_GAME}', 'Visible bundle', 'ACTIVE', '100 coins', 1000, 1200, true, 1, 'private-offer', 'private-category', 0.1234, 15),
      ('${INACTIVE_PACKAGE}', '${ACTIVE_GAME}', 'Inactive bundle', 'INACTIVE', '200 coins', 2000, 2200, false, 2, 'hidden-offer', 'hidden-category', 0.5678, 20),
      ('${PRIVATE_PACKAGE}', '${INACTIVE_GAME}', 'Inactive game bundle', 'PRIVATE', '300 coins', 3000, 3200, true, 3, 'hidden-game-offer', 'hidden-game-category', 0.9999, 25);
    INSERT INTO public.orders (id, customer_user_id, game_id, package_id, reference)
    VALUES
      ('11111111-1111-4111-8111-111111111112', '${CUSTOMER_A}', '${ACTIVE_GAME}', '${ACTIVE_PACKAGE}', 'RF-A'),
      ('22222222-2222-4222-8222-222222222223', '${CUSTOMER_B}', '${ACTIVE_GAME}', '${ACTIVE_PACKAGE}', 'RF-B');
  `);
});

afterAll(async () => {
  await db?.close();
});

describe('public catalog grants preserve RLS and keep supplier fields private', () => {
  it('allows the public storefront columns while hiding inactive catalog rows and private package metadata', async () => {
    await asRole('anon');
    const games = await db.query<{ id: string; name: string }>(
      'SELECT id, name FROM public.games ORDER BY id',
    );
    expect(games.rows).toEqual([{ id: ACTIVE_GAME, name: 'Active Game' }]);

    const packages = await db.query<{ id: string; name: string; amount: string }>(
      'SELECT id, name, amount FROM public.packages ORDER BY id',
    );
    expect(packages.rows).toEqual([{ id: ACTIVE_PACKAGE, name: 'Visible bundle', amount: '100 coins' }]);

    await expect(db.query('SELECT supplier_cost_usd FROM public.packages')).rejects.toThrow(/permission denied/i);
    await expect(db.query('SELECT supplier_offer_id FROM public.packages')).rejects.toThrow(/permission denied/i);
    await expect(db.query('SELECT markup_percent FROM public.packages')).rejects.toThrow(/permission denied/i);
    await expect(db.query('INSERT INTO public.packages (id, game_id, name, sku, amount, price_cents, is_active, sort_order) VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, true, 1)', [ACTIVE_GAME, 'Injected', 'INJECTED', '1']))
      .rejects.toThrow(/permission denied/i);
  });

  it('lets a customer read owner-scoped order embeds without exposing another customer or inactive catalog rows', async () => {
    await asRole('authenticated', CUSTOMER_A);
    const result = await db.query<{ reference: string; game: string | null; package: string | null }>(`
      SELECT o.reference, g.name AS game, p.name AS package
      FROM public.orders o
      LEFT JOIN public.games g ON g.id = o.game_id
      LEFT JOIN public.packages p ON p.id = o.package_id
      ORDER BY o.reference
    `);
    expect(result.rows).toEqual([{ reference: 'RF-A', game: 'Active Game', package: 'Visible bundle' }]);

    await asRole('authenticated', CUSTOMER_B);
    const otherCustomer = await db.query<{ reference: string }>(
      'SELECT reference FROM public.orders WHERE customer_user_id = $1', [CUSTOMER_A],
    );
    expect(otherCustomer.rows).toEqual([]);
  });

  it('grants only the selected public columns and preserves enabled RLS', async () => {
    await db.exec('RESET ROLE');
    const checks = await db.query<{
      games_rls: boolean;
      packages_rls: boolean;
      game_name: boolean;
      package_amount: boolean;
      supplier_cost: boolean;
      supplier_offer: boolean;
      package_table_select: boolean;
      package_insert: boolean;
    }>(`
      SELECT
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.games'::regclass) AS games_rls,
        (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.packages'::regclass) AS packages_rls,
        has_column_privilege('authenticated', 'public.games', 'name', 'SELECT') AS game_name,
        has_column_privilege('authenticated', 'public.packages', 'amount', 'SELECT') AS package_amount,
        has_column_privilege('authenticated', 'public.packages', 'supplier_cost_usd', 'SELECT') AS supplier_cost,
        has_column_privilege('anon', 'public.packages', 'supplier_offer_id', 'SELECT') AS supplier_offer,
        has_table_privilege('authenticated', 'public.packages', 'SELECT') AS package_table_select,
        has_table_privilege('authenticated', 'public.packages', 'INSERT') AS package_insert
    `);
    expect(checks.rows[0]).toEqual({
      games_rls: true,
      packages_rls: true,
      game_name: true,
      package_amount: true,
      supplier_cost: false,
      supplier_offer: false,
      package_table_select: false,
      package_insert: false,
    });
  });
});

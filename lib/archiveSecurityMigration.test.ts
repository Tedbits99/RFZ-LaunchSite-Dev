import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

describe('order archive RPC execute grants', () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it('revokes PUBLIC, anon, and authenticated access while retaining service_role', async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION public.archive_old_unpaid_orders() RETURNS integer
        LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0 $$;
      GRANT EXECUTE ON FUNCTION public.archive_old_unpaid_orders() TO anon, authenticated;
    `);

    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20261019110000_restrict_order_archive_rpc.sql'),
      'utf8',
    );
    await db.exec(migration);

    const { rows } = await db.query<{ role: string; can_execute: boolean }>(`
      SELECT role_name AS role,
        has_function_privilege(role_name, 'public.archive_old_unpaid_orders()', 'EXECUTE') AS can_execute
      FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
      ORDER BY role_name;
    `);
    expect(rows).toEqual([
      { role: 'anon', can_execute: false },
      { role: 'authenticated', can_execute: false },
      { role: 'service_role', can_execute: true },
    ]);
  }, 30000);
});

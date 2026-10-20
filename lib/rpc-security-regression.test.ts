import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20261018151838_20261017090000_security_harden_privileged_rpcs.sql');
const migration = readFileSync(migrationPath, 'utf8');

describe('forward-only privileged RPC migration contract', () => {
  it('covers every privileged function signature identified in the audit', () => {
    expect(migration).toContain('admin_get_all_games()');
    expect(migration).toContain('admin_set_game_active(game_id uuid, active boolean)');
    expect(migration).toContain('admin_get_games_with_package_counts()');
    expect(migration).toContain('admin_change_order_status(uuid, text, text, text)');
    expect(migration).toContain('admin_upsert_payment_config(');
    expect(migration).toContain('admin_delete_payment_config(uuid)');
    expect(migration).toContain('get_supplier_credential(text, text)');
    expect(migration).toContain('set_supplier_credential(text, text, text)');
  });

  it('revokes PUBLIC and anonymous execution and grants trusted roles only', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO authenticated, service_role');
    expect(migration).toContain('TO service_role');
  });

  it('adds database-side operator checks to SECURITY DEFINER read/write functions', () => {
    expect(migration).toContain('IF NOT public.is_payment_operator() THEN');
    expect(migration).toContain("RAISE EXCEPTION 'FORBIDDEN'");
  });

  it('does not contain credential values or destructive data operations', () => {
    expect(migration).not.toMatch(/rfz_[a-z0-9]+/i);
    expect(migration).not.toMatch(/\b(DROP TABLE|TRUNCATE)\b/i);
  });
});

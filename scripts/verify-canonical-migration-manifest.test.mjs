import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parseMigrationManifest, verifyMigrationManifest } from './verify-canonical-migration-manifest.mjs';

const root = process.cwd();
const migrationDirectory = resolve(root, 'supabase/migrations');

describe('canonical disposable migration manifest', () => {
  it('matches every active SQL migration hash and the reviewed include/exclude sequence', () => {
    const manifest = readFileSync(resolve(root, 'docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md'), 'utf8');
    const entries = parseMigrationManifest(manifest);
    const filenames = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort();
    const result = verifyMigrationManifest(entries, filenames, (name) => readFileSync(resolve(migrationDirectory, name)));

    expect(result).toEqual({ failures: [], includedCount: 96, excludedCount: 19 });
    expect(filenames).toHaveLength(115);
  });

  it('rejects changed migrations, added files, and missing canonical sequence numbers', () => {
    const content = Buffer.from('migration body');
    const digest = createHash('sha256').update(content).digest('hex');
    const entries = [
      { sequence: 1, disposition: 'INCLUDE', filename: '20260101000000_first.sql', sha256: digest },
      { sequence: 3, disposition: 'INCLUDE', filename: '20260102000000_second.sql', sha256: digest },
    ];
    const result = verifyMigrationManifest(
      entries,
      ['20260101000000_first.sql', '20260102000000_second.sql', '20260103000000_unlisted.sql'],
      () => Buffer.from('changed body'),
    );

    expect(result.failures).toContain('Migrations missing from canonical manifest: 20260103000000_unlisted.sql');
    expect(result.failures).toContain('SHA-256 mismatch: 20260101000000_first.sql');
    expect(result.failures).toContain('Included migration sequence numbers must be consecutive and ordered from 1 through 96');
  });

  it('rejects deferred RF Coins and scheduler migrations if they enter the include set', () => {
    const result = verifyMigrationManifest(
      [{ sequence: 1, disposition: 'INCLUDE', filename: '20260101000000_rf_coins.sql', sha256: '0'.repeat(64) }],
      ['20260101000000_rf_coins.sql'],
      () => Buffer.alloc(0),
    );

    expect(result.failures).toContain('Deferred migration selected for disposable execution: 20260101000000_rf_coins.sql');
  });
});

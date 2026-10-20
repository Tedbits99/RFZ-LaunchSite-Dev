import { createHash } from 'node:crypto';
import { error as writeError, log as writeLog } from 'node:console';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseMigrationManifest(markdown) {
  const entries = [];
  const rowPattern = /^\|\s*(\d+|—)\s*\|\s*(INCLUDE|EXCLUDE)\s*\|\s*`([^`]+)`\s*\|\s*`([a-f\d]{64})`\s*\|/;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(rowPattern);
    if (!match) continue;
    entries.push({
      sequence: match[1] === '—' ? null : Number(match[1]),
      disposition: match[2],
      filename: match[3],
      sha256: match[4],
    });
  }
  return entries;
}

export function verifyMigrationManifest(entries, actualFilenames, readMigration) {
  const failures = [];
  const manifestNames = entries.map((entry) => entry.filename);
  const duplicateNames = manifestNames.filter((name, index) => manifestNames.indexOf(name) !== index);
  if (duplicateNames.length) failures.push(`Duplicate manifest entries: ${[...new Set(duplicateNames)].join(', ')}`);

  const expectedNames = new Set(manifestNames);
  const actualNames = new Set(actualFilenames);
  const missing = manifestNames.filter((name) => !actualNames.has(name));
  const unlisted = actualFilenames.filter((name) => !expectedNames.has(name));
  if (missing.length) failures.push(`Manifest migrations missing from supabase/migrations: ${missing.join(', ')}`);
  if (unlisted.length) failures.push(`Migrations missing from canonical manifest: ${unlisted.join(', ')}`);

  for (const entry of entries) {
    if (!actualNames.has(entry.filename)) continue;
    const digest = createHash('sha256').update(readMigration(entry.filename)).digest('hex');
    if (digest !== entry.sha256) failures.push(`SHA-256 mismatch: ${entry.filename}`);
  }

  const included = entries.filter((entry) => entry.disposition === 'INCLUDE');
  const excluded = entries.filter((entry) => entry.disposition === 'EXCLUDE');
  if (included.length !== 96) failures.push(`Expected 96 included migrations, found ${included.length}`);
  if (excluded.length !== 19) failures.push(`Expected 19 excluded migrations, found ${excluded.length}`);
  if (included.some((entry, index) => entry.sequence !== index + 1)) {
    failures.push('Included migration sequence numbers must be consecutive and ordered from 1 through 96');
  }

  const unsafeIncluded = included.filter(({ filename }) => /(?:rf_coins|schedule_auto_reconciliation)/i.test(filename));
  if (unsafeIncluded.length) failures.push(`Deferred migration selected for disposable execution: ${unsafeIncluded.map(({ filename }) => filename).join(', ')}`);

  return { failures, includedCount: included.length, excludedCount: excluded.length };
}

async function main() {
  const manifestPath = resolve(root, 'docs/transformation/CANONICAL_DISPOSABLE_MIGRATION_SEQUENCE.md');
  const migrationsPath = resolve(root, 'supabase/migrations');
  const markdown = await readFile(manifestPath, 'utf8');
  const entries = parseMigrationManifest(markdown);
  const filenames = (await readdir(migrationsPath)).filter((name) => name.endsWith('.sql')).sort();
  const result = verifyMigrationManifest(entries, filenames, (name) => readFileSync(resolve(migrationsPath, name)));
  if (result.failures.length) {
    writeError(result.failures.map((failure) => `MIGRATION_MANIFEST_ERROR: ${failure}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  writeLog(`CANONICAL_MIGRATION_MANIFEST_PASS included=${result.includedCount} excluded=${result.excludedCount} actual=${filenames.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    writeError(`MIGRATION_MANIFEST_ERROR: ${error instanceof Error ? error.message : 'Unable to verify migration manifest'}`);
    process.exitCode = 1;
  });
}

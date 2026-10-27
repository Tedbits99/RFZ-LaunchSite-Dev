import { readFileSync } from 'node:fs';
import process from 'node:process';

const file = process.argv[2] ?? 'wrangler.jsonc';
const fail = (reason) => {
  process.stderr.write(`BLOCKED: candidate Wrangler configuration ${reason}.\n`);
  process.exit(1);
};

let config;
try {
  config = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  fail('is unreadable or is not strict JSON');
}
if (!config || typeof config !== 'object' || Array.isArray(config)) {
  fail('must be a JSON object');
}

const allowedTopLevelKeys = [
  '$schema',
  'main',
  'name',
  'compatibility_date',
  'compatibility_flags',
  'assets',
].sort();
if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(allowedTopLevelKeys)) {
  fail('contains an unapproved top-level setting or binding');
}

if (
  config.$schema !== 'node_modules/wrangler/config-schema.json' ||
  config.main !== '.open-next/worker.js' ||
  config.name !== 'runfazone-preview' ||
  config.compatibility_date !== '2025-03-01' ||
  JSON.stringify(config.compatibility_flags) !== JSON.stringify(['nodejs_compat', 'global_fetch_strictly_public'])
) {
  fail('does not match the reviewed private preview Worker settings');
}

if (
  !config.assets ||
  JSON.stringify(Object.keys(config.assets).sort()) !== JSON.stringify(['binding', 'directory']) ||
  config.assets.directory !== '.open-next/assets' ||
  config.assets.binding !== 'ASSETS'
) {
  fail('contains an unapproved asset binding');
}

process.stdout.write('CANDIDATE_WRANGLER_CONFIG_PASS worker=runfazone-preview bindings=ASSETS only routes=none domains=none triggers=none\n');

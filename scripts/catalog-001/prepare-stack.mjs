import assert from 'node:assert/strict';
import console from 'node:console';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { allocateIsolatedPorts, PORT_NAMES, validateIsolatedPorts } from '../isolated-auth-stack.mjs';

const root = process.cwd();
const target = path.resolve(process.argv[2] || '');
const envPath = path.resolve(process.argv[3] || '');
assert(path.isAbsolute(target) && target !== root && !target.startsWith(`${root}${path.sep}`), 'stack must live outside the checkout');
const allowedTempRoots = [process.env.RUNNER_TEMP, process.env.TMPDIR, os.tmpdir(), '/tmp'].filter(Boolean).map((value) => path.resolve(value));
assert(allowedTempRoots.some((tempRoot) => target === tempRoot || target.startsWith(`${tempRoot}${path.sep}`)), 'stack must live under a temporary directory');
assert(!fs.existsSync(path.join(target, 'supabase', '.temp', 'project-ref')), 'refusing a linked Supabase workdir');
assert(envPath && path.isAbsolute(envPath), 'an environment output path is required');
fs.mkdirSync(target, { recursive: true });
assert(!fs.lstatSync(target).isSymbolicLink(), 'stack root cannot be a symbolic link');
assert(fs.readdirSync(target).length === 0, 'stack root must be a fresh empty temporary directory');

const run = process.env.GITHUB_RUN_ID || String(Date.now());
const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
assert(/^[0-9]{1,20}$/.test(run) && /^[0-9]{1,4}$/.test(attempt), 'invalid disposable run identity');
const projectId = `rfz-catalog001-${run}-${attempt}`;
const ports = await allocateIsolatedPorts();
validateIsolatedPorts(ports);

const configSource = path.join(root, 'supabase', 'e2e', 'config.toml');
let config = fs.readFileSync(configSource, 'utf8');
const replacements = [
  [/^project_id = "runfazone-pr82-isolated-auth"$/gm, `project_id = "${projectId}"`],
  [/^port = 54321$/gm, `port = ${ports.E2E_LOCAL_API_PORT}`],
  [/^port = 54322$/gm, `port = ${ports.E2E_LOCAL_DB_PORT}`],
  [/^shadow_port = 54320$/gm, `shadow_port = ${ports.E2E_LOCAL_SHADOW_PORT}`],
  [/^port = 54324$/gm, `port = ${ports.E2E_LOCAL_MAILPIT_PORT}`],
  [/^smtp_port = 54325$/gm, `smtp_port = ${ports.E2E_LOCAL_SMTP_PORT}`],
  [/^pop3_port = 54326$/gm, `pop3_port = ${ports.E2E_LOCAL_POP3_PORT}`],
];
for (const [pattern, replacement] of replacements) {
  assert([...config.matchAll(pattern)].length === 1, 'unexpected disposable Supabase config template');
  config = config.replace(pattern, replacement);
}
assert(config.includes('major_version = 17'), 'disposable catalog stack must use PostgreSQL 17');
assert(config.includes('host = "inbucket"\nport = 1025'), 'Auth SMTP must remain bound to local Inbucket');

const supabaseRoot = path.join(target, 'supabase');
const migrationsRoot = path.join(supabaseRoot, 'migrations');
fs.mkdirSync(migrationsRoot, { recursive: true });
fs.writeFileSync(path.join(supabaseRoot, 'config.toml'), config, { mode: 0o600 });
const migrationFiles = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => name.endsWith('.sql')).sort();
assert(migrationFiles.length > 0, 'canonical migration directory is empty');
for (const name of migrationFiles) fs.copyFileSync(path.join(root, 'supabase', 'migrations', name), path.join(migrationsRoot, name), fs.constants.COPYFILE_EXCL);
assert(!fs.existsSync(path.join(supabaseRoot, '.temp', 'project-ref')), 'refusing a linked Supabase workdir');

const lines = [
  `RFZ_STACK_ROOT=${target}`,
  `RFZ_STACK_PROJECT_ID=${projectId}`,
  `RFZ_MIGRATION_FILE_COUNT=${migrationFiles.length}`,
  ...Object.entries(ports).map(([name, value]) => `${name}=${value}`),
  '',
];
fs.appendFileSync(envPath, lines.join('\n'), { mode: 0o600 });
console.log(`CATALOG_DISPOSABLE_STACK_PREPARED project=${projectId} migrations=${migrationFiles.length} distinct_loopback_ports=${PORT_NAMES.length}`);

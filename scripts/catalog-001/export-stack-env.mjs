import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const statusPath = process.argv[2];
const outputPath = process.argv[3];
assert(statusPath && outputPath, 'expected local status output and environment output paths');
assert(process.env.E2E_LOCAL_API_PORT && process.env.E2E_LOCAL_DB_PORT, 'isolated local ports are missing');

const status = Object.create(null);
for (const line of fs.readFileSync(statusPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
  const separator = line.indexOf('=');
  assert(separator > 0, 'unexpected disposable Supabase status format');
  const key = line.slice(0, separator);
  let value = line.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  assert(!Object.hasOwn(status, key), 'duplicate local Supabase status key');
  status[key] = value;
}

const api = status.API_URL || status.SUPABASE_URL;
const dbUrl = status.DB_URL || status.POSTGRES_URL;
const anon = status.ANON_KEY || status.SUPABASE_ANON_KEY;
const service = status.SERVICE_ROLE_KEY || status.SUPABASE_SERVICE_ROLE_KEY;
assert(api && dbUrl && anon && service, 'local Supabase did not report required API, DB, and JWT values');
const apiUrl = new URL(api);
assert(apiUrl.protocol === 'http:' && apiUrl.hostname === '127.0.0.1' && apiUrl.port === process.env.E2E_LOCAL_API_PORT && apiUrl.pathname === '/', 'refusing non-loopback or unexpected local API origin');
const databaseUrl = new URL(dbUrl);
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol) && databaseUrl.hostname === '127.0.0.1' && databaseUrl.port === process.env.E2E_LOCAL_DB_PORT, 'refusing non-loopback or unexpected local database URL');

function jwtRole(token) {
  const pieces = token.split('.');
  assert(pieces.length === 3, 'local API key is not a JWT');
  return JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8')).role;
}
assert(jwtRole(anon) === 'anon' && jwtRole(service) === 'service_role', 'local Supabase JWT roles do not match the expected isolated roles');

for (const forbidden of [
  'PAYMONGO_SECRET_KEY', 'PAYMENT_PAYMONGO_SECRET_KEY', 'FAZERCARDS_API_KEY',
  'SUPPLIER_FAZERCARDS_API_KEY', 'SMTP_PASSWORD', 'CRYPTO_PROVIDER_SECRET',
]) assert(!process.env[forbidden], 'provider credentials are not permitted in catalog acceptance');

const candidateSha = process.env.CATALOG_CANDIDATE_SHA || process.env.GITHUB_SHA || 'LOCAL_UNCOMMITTED';
assert(candidateSha === 'LOCAL_UNCOMMITTED' || /^[0-9a-f]{40}$/.test(candidateSha), 'candidate SHA is malformed');
const hmac = randomBytes(48).toString('base64url');
const values = {
  NEXT_PUBLIC_SUPABASE_URL: apiUrl.origin,
  SUPABASE_URL: apiUrl.origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  CATALOG_SUPABASE_URL: apiUrl.origin,
  CATALOG_ANON_KEY: anon,
  CATALOG_SERVICE_ROLE_KEY: service,
  CATALOG_LOCAL_DB_URL: dbUrl,
  CATALOG_LOCAL_API_PORT: process.env.E2E_LOCAL_API_PORT,
  CATALOG_APP_URL: 'http://127.0.0.1:3000',
  CATALOG_CANDIDATE_SHA: candidateSha,
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
  PAYMENT_MODE: 'mock',
  PAYMENT_PROVIDER: 'mock',
  NEXT_TELEMETRY_DISABLED: '1',
  RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE: 'disabled',
  RFZ_RECOVERY_PROOF_HMAC_SECRET: hmac,
  RFZ_CUSTOMER_CONFIRMATION_RESEND_HMAC_SECRET: hmac,
  E2E_MAILPIT_URL: `http://127.0.0.1:${process.env.E2E_LOCAL_MAILPIT_PORT}`,
};
for (const [name, value] of Object.entries(values)) assert(!/[\r\n]/.test(value), `unsafe newline in ${name}`);
fs.appendFileSync(outputPath, `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n')}\n`, { mode: 0o600 });
fs.chmodSync(statusPath, 0o600);
fs.unlinkSync(statusPath);
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const secret of [anon, service, hmac, dbUrl, databaseUrl.password]) process.stdout.write(`::add-mask::${secret}\n`);
}
console.log(`CATALOG_LOCAL_BINDING_PASS api=${apiUrl.origin} database=${databaseUrl.hostname}:${databaseUrl.port} project=${process.env.RFZ_STACK_PROJECT_ID}`);

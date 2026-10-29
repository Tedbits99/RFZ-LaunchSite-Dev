import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { URL } from 'node:url';

const outputPath = process.argv[2];
assert(outputPath, 'expected an environment output path');
const api = process.env.CATALOG_SUPABASE_URL || '';
const apiUrl = new URL(api);
assert(apiUrl.protocol === 'http:' && apiUrl.hostname === '127.0.0.1' && apiUrl.port === process.env.CATALOG_LOCAL_API_PORT, 'Auth fixtures refuse non-loopback or unexpected Supabase origins');
const serviceKey = process.env.CATALOG_SERVICE_ROLE_KEY || '';
const serviceClaims = JSON.parse(Buffer.from(serviceKey.split('.')[1] || '', 'base64url').toString('utf8'));
assert(serviceClaims.role === 'service_role', 'Auth fixture provisioning requires the disposable service-role JWT');

const adminClient = createClient(api, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anonKey = process.env.CATALOG_ANON_KEY || '';
assert(anonKey, 'disposable anonymous key is missing');
const definitions = [
  // The customer-profile status RPC deliberately requires SUPER_ADMIN. This
  // identity exists only in the disposable fixture and matches that guard.
  { key: 'ADMIN', email: 'admin@example.invalid', name: 'Synthetic Catalog Admin', role: 'SUPER_ADMIN' },
  { key: 'STAFF', email: 'staff@example.invalid', name: 'Synthetic Catalog Staff', role: 'STAFF' },
  { key: 'CUSTOMER', email: 'customer@example.invalid', name: 'Synthetic Catalog Customer', role: null },
];

async function ensureUser({ email, name }, password) {
  const { data: page, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error('Could not inspect disposable Auth fixture users.');
  const existing = page.users.find((user) => user.email?.toLowerCase() === email);
  if (existing) {
    const { data, error } = await adminClient.auth.admin.updateUserById(existing.id, {
      password, email_confirm: true, user_metadata: { full_name: name, synthetic_fixture: 'catalog-001' },
    });
    if (error || !data.user) throw new Error('Could not refresh a disposable Auth fixture user.');
    return data.user.id;
  }
  const { data, error } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name, synthetic_fixture: 'catalog-001' },
  });
  if (error || !data.user) throw new Error('Could not create a disposable Auth fixture user.');
  return data.user.id;
}

const credentials = Object.create(null);
const ids = Object.create(null);
for (const definition of definitions) {
  const password = randomBytes(32).toString('base64url');
  ids[definition.key] = await ensureUser(definition, password);
  credentials[definition.key] = { email: definition.email, password };
}

const adminRows = definitions.filter((definition) => definition.role).map((definition) => ({
  id: ids[definition.key], email: definition.email, name: definition.name,
  role: definition.role, is_active: true,
}));
const { error: adminError } = await adminClient.from('admins').upsert(adminRows, { onConflict: 'id' });
if (adminError) throw new Error('Could not provision synthetic catalog authorization roles.');

const authenticatedAdmin = createClient(api, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const adminLogin = await authenticatedAdmin.auth.signInWithPassword(credentials.ADMIN);
if (adminLogin.error || !adminLogin.data.session) throw new Error('Synthetic admin could not sign in to the disposable Auth service.');
const activated = await authenticatedAdmin.rpc('admin_set_customer_profile_status', {
  p_user_id: ids.CUSTOMER, p_status: 'active',
});
const activationRows = activated.data;
if (activated.error || !Array.isArray(activationRows) || activationRows.length !== 1
  || activationRows[0]?.out_status !== 'active' || activationRows[0]?.out_error !== null) {
  const detail = activated.error ? `RPC error ${activated.error.code || 'unknown'}` : 'unexpected RPC result';
  throw new Error(`Could not activate the synthetic customer profile through the admin RPC (${detail}).`);
}
await authenticatedAdmin.auth.signOut({ scope: 'local' });

const runTag = process.env.CATALOG_RUN_TAG || `local-${Date.now()}`;
assert(/^[a-zA-Z0-9-]{1,64}$/.test(runTag), 'catalog run tag is malformed');
const values = {
  CATALOG_ADMIN_EMAIL: credentials.ADMIN.email,
  CATALOG_ADMIN_PASSWORD: credentials.ADMIN.password,
  CATALOG_STAFF_EMAIL: credentials.STAFF.email,
  CATALOG_STAFF_PASSWORD: credentials.STAFF.password,
  CATALOG_CUSTOMER_EMAIL: credentials.CUSTOMER.email,
  CATALOG_CUSTOMER_PASSWORD: credentials.CUSTOMER.password,
  CATALOG_RUN_TAG: runTag,
};
for (const [name, value] of Object.entries(values)) assert(!/[\r\n]/.test(value), `unsafe newline in ${name}`);
fs.appendFileSync(outputPath, `${Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n')}\n`, { mode: 0o600 });
if (process.env.GITHUB_ACTIONS === 'true') {
  for (const password of [credentials.ADMIN.password, credentials.STAFF.password, credentials.CUSTOMER.password]) process.stdout.write(`::add-mask::${password}\n`);
}
console.log('CATALOG_SYNTHETIC_AUTH_FIXTURES_PASS identities=admin,staff,customer email_delivery=none');

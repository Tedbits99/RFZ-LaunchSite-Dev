import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const fixtureFile = process.env.RFZ_UIUX_FIXTURE_FILE;
if (!url || !serviceKey || !anonKey || !fixtureFile) throw new Error('Disposable fixture configuration is incomplete.');

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const auth = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const suffix = `${Date.now()}-${process.pid}`;
const password = 'RunFazone-UIUX007-test-password!';
const definitions = [
  { key: 'customerA', email: `uiux007-customer-a-${suffix}@example.test` },
  { key: 'customerB', email: `uiux007-customer-b-${suffix}@example.test` },
  { key: 'admin', email: `uiux007-admin-${suffix}@example.test` },
];
const created = [];

try {
  for (const definition of definitions) {
    const { data, error } = await db.auth.admin.createUser({
      email: definition.email,
      password,
      email_confirm: true,
      user_metadata: { uiux_test_fixture: true, persona: definition.key },
    });
    if (error || !data.user) throw new Error(`Could not create disposable ${definition.key}.`);
    created.push({ ...definition, id: data.user.id });
  }

  for (const user of created) {
    const { data: session, error: signInError } = await auth.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (signInError || !session.user) throw new Error(`Could not sign in disposable ${user.key} fixture.`);
    const { error: activationError } = await auth.rpc('activate_customer_profile');
    await auth.auth.signOut({ scope: 'local' });
    if (activationError) throw new Error(`Could not activate disposable ${user.key} profile.`);
  }

  const admin = created.find((user) => user.key === 'admin');
  const { error: adminError } = await db.from('admins').upsert({
    id: admin.id,
    email: admin.email,
    name: 'UIUX Test Administrator',
    role: 'SUPER_ADMIN',
    is_active: true,
  });
  if (adminError) throw new Error('Could not provision the disposable administrator role.');

  await writeFile(fixtureFile, JSON.stringify({ password, users: created }), { mode: 0o600 });
} catch (error) {
  for (const user of created) await db.auth.admin.deleteUser(user.id);
  throw error;
}

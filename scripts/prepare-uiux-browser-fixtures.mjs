import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fixtureFile = process.env.RFZ_UIUX_FIXTURE_FILE;
if (!url || !serviceKey || !fixtureFile) throw new Error('Disposable fixture configuration is incomplete.');

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
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
    const { error } = await db.from('customer_profiles')
      .update({ status: 'active', display_name: `UIUX ${user.key}` })
      .eq('user_id', user.id);
    if (error) throw new Error(`Could not activate disposable ${user.key} profile.`);
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

import { readFile, rm } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import process from 'node:process';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fixtureFile = process.env.RFZ_UIUX_FIXTURE_FILE;
if (!url || !serviceKey || !fixtureFile) process.exit(0);

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
try {
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'));
  for (const user of fixture.users ?? []) await db.auth.admin.deleteUser(user.id);
} finally {
  await rm(fixtureFile, { force: true });
}

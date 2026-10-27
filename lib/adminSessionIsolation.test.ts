import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('admin authentication namespace and bootstrap boundaries', () => {
  it('uses the dedicated admin browser namespace and never self-bootstraps', () => {
    const login = source('app/secure-admin-login/page.tsx');
    expect(login).toContain('createAdminBrowserClient');
    expect(login).not.toContain('claim_first_admin');
    expect(login).toContain(".from('admins')");
    expect(login).toContain('authenticateAdmin');
    const flow = source('lib/adminLoginFlow.ts');
    expect(flow).toContain("['ADMIN', 'SUPER_ADMIN']");
    expect(flow).toContain('!admin.is_active');
  });

  it('uses the dedicated admin namespace for server guards and cookie refresh', () => {
    const guard = source('lib/adminGuard.ts');
    const proxy = source('proxy.ts');
    expect(guard).toContain('createAdminServerClient');
    expect(guard).toContain('ADMIN_SESSION_COOKIE');
    expect(proxy).toContain('AUTH_SESSION_COOKIES.admin');
  });

  it('removes client-role execution from the historical first-admin RPC', () => {
    const migration = source('supabase/migrations/20261026130000_lock_first_admin_bootstrap.sql');
    expect(migration).toContain('REVOKE EXECUTE');
    expect(migration).toContain('authenticated');
    expect(migration).toContain('claim_first_admin');
  });

  it('keeps admin data pages on the admin session client', () => {
    for (const path of ['app/admin/page.tsx', 'app/admin/games/page.tsx', 'app/admin/games/[id]/packages/page.tsx']) {
      const content = source(path);
      expect(content).toContain('createAdminServerClient');
      expect(content).not.toContain("from '@/lib/supabaseServer'");
    }
  });
});

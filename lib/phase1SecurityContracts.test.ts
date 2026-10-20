import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 1 security boundary contracts', () => {
  it('requires an authenticated active admin and explicit confirmation for FazerCards orders', () => {
    const edgeFunction = source('supabase/functions/fazercards-test/index.ts');
    expect(edgeFunction).toContain('authClient.auth.getUser(accessToken)');
    expect(edgeFunction).toContain('.select("role, is_active")');
    expect(edgeFunction).toContain('isActiveAdmin(admin)');
    expect(edgeFunction).toContain('mayCreateSupplierOrder(admin)');
    expect(edgeFunction).toContain('body.confirmed !== true');
  });

  it('keeps the archive function behind server credentials and revokes client RPC access', () => {
    const worker = source('supabase/functions/archive-old-orders/index.ts');
    const migration = source('supabase/migrations/20261019110000_restrict_order_archive_rpc.sql');
    expect(worker).toContain('req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });

  it('rejects inactive admins in the shared server-side admin guard', () => {
    const guard = source('lib/adminGuard.ts');
    expect(guard).toContain(".select('email, name, role, is_active')");
    expect(guard).toContain('admin?.is_active === true');
  });

  it('gates server-rendered admin pages and customer-order candidate reads behind admin authorization', () => {
    const layout = source('app/admin/layout.tsx');
    const candidatesApi = source('app/api/admin/test-order-candidates/route.ts');
    const testOrderClient = source('app/admin/suppliers/controlled-test-order/ControlledTestOrderClient.tsx');
    expect(layout).toContain('await getAdminSession()');
    expect(layout).toContain('if (!session) notFound()');
    expect(candidatesApi).toContain('await requireAdmin(req)');
    expect(testOrderClient).toContain('/api/admin/test-order-candidates');
    expect(testOrderClient).not.toContain('/rest/v1/orders?');
  });
});

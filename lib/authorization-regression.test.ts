import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('privileged route authorization contracts', () => {
  const protectedRoutes = [
    'app/api/admin/orders/route.ts',
    'app/api/export/route.ts',
    'app/api/games/route.ts',
    'app/api/payment-config/route.ts',
    'app/api/suppliers/route.ts',
    'app/api/suppliers/actions/route.ts',
    'app/api/suppliers/mappings/route.ts',
    'app/api/suppliers/transactions/route.ts',
  ];

  for (const route of protectedRoutes) {
    it(`${route} requires the shared server-side admin guard`, () => {
      const code = source(route);
      expect(code).toContain("from '@/lib/adminGuard'");
      expect(code).toMatch(/await requireAdmin\(req\)/);
      expect(code).toContain('if (!auth.ok) return auth.response;');
    });
  }

  it('keeps announcement reads public while guarding writes', () => {
    const code = source('app/api/announcement/route.ts');
    expect(code).toMatch(/export async function GET\(\)/);
    expect(code).toMatch(/export async function POST\(req: NextRequest\)/);
    expect(code).toMatch(/POST[\s\S]*await requireAdmin\(req\)/);
  });
});

describe('customer order ownership contracts', () => {
  it('uses verified customer-namespace auth and profile status before checkout', () => {
    const code = source('app/api/orders/route.ts');

    expect(code).toContain('createCustomerServerClient');
    expect(code).toContain('auth.getUser()');
    expect(code).toContain("from('customer_profiles')");
    expect(code).toContain("profile.status !== 'active'");
    expect(code).toContain('hasCustomerAuthCookie');
    expect(code).toContain('const rpcClient = customerClient || supabase;');
    expect(code).toContain('__rfz_order_access_hash');
  });

  it('requires a private capability or verified account ownership for order tracking', () => {
    const statusCode = source('app/api/orders/[id]/status-check/route.ts');
    const lookupCode = source('app/api/orders/lookup/route.ts');
    const timelineCode = source('app/api/orders/[id]/timeline/route.ts');

    expect(statusCode).toContain('authorizeOrderRequest(req, order)');
    expect(statusCode).toContain('isOrderOwner(email, order.email)');
    expect(lookupCode).toContain('isOrderOwner(email, order.email)');
    expect(timelineCode).toContain('isOrderOwner(email, order.email)');
    expect(lookupCode).toContain("req.json()");
    expect(statusCode).not.toContain("select('id, status, actor_email");
    expect(statusCode).not.toContain(".ilike('email'");
    expect(lookupCode).not.toContain(".ilike('email'");
    expect(timelineCode).not.toContain(".ilike('email'");
  });

  it('binds account order access only to the verified Auth UUID', () => {
    const pageCode = source('app/account/orders/[id]/page.tsx');
    const listCode = source('app/account/orders/page.tsx');
    const accountCode = source('app/account/page.tsx');

    expect(pageCode).toContain('getActiveCustomerSession');
    expect(pageCode).toContain(".eq('customer_user_id', session.user.id)");
    expect(pageCode).not.toContain('isOrderOwner');
    expect(listCode).toContain('getActiveCustomerSession');
    expect(listCode).toContain(".eq('customer_user_id', session.user.id)");
    expect(listCode).not.toContain(".ilike('email'");
    expect(accountCode).toContain('getActiveCustomerSession');
    expect(accountCode).toContain(".eq('customer_user_id', session.user.id)");
  });
});

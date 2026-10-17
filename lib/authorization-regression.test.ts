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
  it('requires exact email ownership for status checks and guest tracking', () => {
    const statusCode = source('app/api/orders/[id]/status-check/route.ts');
    const lookupCode = source('app/api/orders/lookup/route.ts');
    const timelineCode = source('app/api/orders/[id]/timeline/route.ts');

    expect(statusCode).toContain("status: 401");
    expect(statusCode).toContain('isOrderOwner(email, order.email)');
    expect(lookupCode).toContain('isOrderOwner(email, order.email)');
    expect(timelineCode).toContain('isOrderOwner(email, order.email)');
    expect(statusCode).not.toContain(".ilike('email'");
    expect(lookupCode).not.toContain(".ilike('email'");
    expect(timelineCode).not.toContain(".ilike('email'");
  });

  it('binds account detail access to the authenticated email or guest proof', () => {
    const pageCode = source('app/account/orders/[id]/page.tsx');
    const listCode = source('app/account/orders/page.tsx');
    const accountCode = source('app/account/page.tsx');

    expect(pageCode).toContain('createSupabaseServerClient');
    expect(pageCode).toContain('isOrderOwner(accessEmail, order.email)');
    expect(listCode).toContain('createSupabaseServerClient');
    expect(listCode).toContain(".eq('email', authenticatedEmail)");
    expect(listCode).not.toContain(".ilike('email'");
    expect(accountCode).toContain('createSupabaseServerClient');
    expect(accountCode).toContain(".eq('email', email)");
  });
});

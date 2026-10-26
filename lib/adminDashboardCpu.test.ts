import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guard against accidentally bringing back the extra getUser round-trip on
 * every dashboard SSR. Authorization belongs to the /admin layout and API
 * handlers; this test does not weaken either one.
 */
describe('Cloudflare admin dashboard CPU regression', () => {
  it('requires a validated admin session in the enclosing server layout', () => {
    const layout = readFileSync('app/admin/layout.tsx', 'utf8');
    expect(layout).toContain('await getAdminSession()');
    expect(layout).toContain('if (!session) notFound()');
    expect(layout).toContain("export const dynamic = 'force-dynamic'");
  });

  it('does not repeat the expensive Supabase auth.getUser call in metrics rendering', () => {
    const page = readFileSync('app/admin/page.tsx', 'utf8');
    expect(page).toContain("createSupabaseServerClient()");
    expect(page).not.toMatch(/db\.auth\.getUser\s*\(/);
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });

  it('retains backend admin authorization for the supplier event API', () => {
    const route = readFileSync('app/api/admin/fazercards-webhooks/route.ts', 'utf8');
    expect(route).toMatch(/requireAdmin|createAdminServerClient|getAdminSession/);
  });
});

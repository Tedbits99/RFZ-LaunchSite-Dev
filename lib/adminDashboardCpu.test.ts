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
    expect(page).toContain("createAdminServerClient()");
    expect(page).not.toMatch(/db\.auth\.getUser\s*\(/);
    expect(page).toContain("export const dynamic = 'force-dynamic'");
  });

  it('keeps admin-header actions and customer email responsive on narrow screens', () => {
    const shell = readFileSync('app/admin/AdminShell.tsx', 'utf8');
    const account = readFileSync('app/account/page.tsx', 'utf8');
    expect(shell).toContain('max-w-[92px]');
    expect(shell).toContain('aria-label="Log out of admin dashboard"');
    expect(shell).toContain('hidden sm:inline">Log out');
    expect(account).toContain('font-display break-all text-base');
  });

  it('uses Supabase Realtime and does not poll admin APIs every ten seconds', () => {
    const feed = readFileSync('app/admin/suppliers/FazerCardsWebhookFeed.tsx', 'utf8');
    expect(feed).toContain('if (!liveRef.current) void refresh()');
    expect(feed).toContain('60000');
    expect(feed).not.toContain('10000');
    expect(feed).toContain("status === 'SUBSCRIBED'");
  });

  it('retains backend admin authorization for the supplier event API', () => {
    const route = readFileSync('app/api/admin/fazercards-webhooks/route.ts', 'utf8');
    expect(route).toMatch(/requireAdmin|createAdminServerClient|getAdminSession/);
  });
});

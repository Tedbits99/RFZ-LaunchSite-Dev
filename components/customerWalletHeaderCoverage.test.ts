import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('global customer wallet header coverage', () => {
  it('attaches the balance chip only after CustomerAccountMenu confirms an authenticated account', () => {
    const menu = read('./CustomerAccountMenu.tsx');
    expect(menu).toContain("if (accountState === 'anonymous' || !account)");
    expect(menu).toContain('<CustomerWalletBalance authenticated compact={compactOnMobile} />');
    expect(menu.indexOf("if (accountState === 'anonymous' || !account)")).toBeLessThan(menu.indexOf('<CustomerWalletBalance authenticated'));
  });

  it('places the shared account header on the storefront and customer commerce routes', () => {
    const headers = [
      read('../app/page.tsx'),
      read('./AccountNavigation.tsx'),
      read('../app/games/[slug]/GameTopUp.tsx'),
      read('../app/checkout/page.tsx'),
      read('../app/track-order/page.tsx'),
      read('../app/(legal)/layout.tsx'),
    ];
    for (const source of headers) expect(source).toContain('CustomerAccountMenu');
  });

  it('keeps the customer wallet component out of administrator navigation', () => {
    expect(read('./../app/admin/AdminShell.tsx')).not.toContain('CustomerAccountMenu');
    expect(read('./../app/admin/AdminShell.tsx')).not.toContain('CustomerWalletBalance');
  });
});

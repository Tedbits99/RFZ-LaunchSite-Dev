import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

describe('storefront responsive account header contract', () => {
  it('keeps the authentication-aware profile control beside theme and menu on mobile', () => {
    const mobileHeader = source.match(/<div className="flex items-center gap-2 md:hidden">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(mobileHeader).toContain('<CustomerAccountMenu compactOnMobile />');
    expect(mobileHeader).toContain('<ThemeSelector />');
    expect(mobileHeader).toContain('aria-label={mobileOpen ? \'Close menu\' : \'Open menu\'}');
  });

  it('does not duplicate the account menu again inside the expanded mobile links', () => {
    const drawer = source.match(/mobileOpen && <nav aria-label="Mobile navigation"([\s\S]*?)<\/nav>/)?.[1] ?? '';
    expect(drawer).not.toContain('CustomerAccountMenu');
  });
});

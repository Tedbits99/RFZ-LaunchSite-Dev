import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { RFZ_PUBLIC_ASSETS } from './storefrontAssets';

describe('recovered storefront campaign', () => {
  it('uses the repository-owned logo so headers do not depend on a third-party image request', () => {
    expect(RFZ_PUBLIC_ASSETS.logo).toBe('/assets/runfazone/logo.webp');
    expect(existsSync(new URL(`../public${RFZ_PUBLIC_ASSETS.logo}`, import.meta.url))).toBe(true);
  });

  it('keeps the complete original three-banner manifest', () => {
    expect(RFZ_PUBLIC_ASSETS.heroBanners).toHaveLength(3);
    expect(RFZ_PUBLIC_ASSETS.heroBanners).toEqual([
      '/assets/runfazone/banner-01.webp',
      '/assets/runfazone/banner-02.webp',
      '/assets/runfazone/banner-03.webp',
    ]);
  });
});

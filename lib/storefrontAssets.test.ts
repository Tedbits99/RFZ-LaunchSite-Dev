import { describe, expect, it } from 'vitest';
import { RFZ_PUBLIC_ASSETS } from './storefrontAssets';

describe('recovered storefront campaign', () => {
  it('keeps the complete original three-banner manifest', () => {
    expect(RFZ_PUBLIC_ASSETS.heroBanners).toHaveLength(3);
    expect(RFZ_PUBLIC_ASSETS.heroBanners).toEqual([
      '/assets/runfazone/banner-01.webp',
      '/assets/runfazone/banner-02.webp',
      '/assets/runfazone/banner-03.webp',
    ]);
  });
});

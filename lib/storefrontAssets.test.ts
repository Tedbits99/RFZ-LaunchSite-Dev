import { describe, expect, it } from 'vitest';
import { RFZ_PUBLIC_ASSETS } from './storefrontAssets';

describe('recovered storefront campaign', () => {
  it('uses the owner-provided brand image for shared storefront and admin headers', () => {
    expect(RFZ_PUBLIC_ASSETS.logo).toBe('https://res.cloudinary.com/dex5ykrfs/image/upload/v1792987471/file_00000000a3c082078081a735ed68ce28_tnzc5h.png');
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

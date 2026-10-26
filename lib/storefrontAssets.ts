/**
 * Stable, repository-owned storefront artwork.
 *
 * These assets are the original RunFazone campaign banners recovered from
 * the reviewed storefront implementation. Keeping the manifest local means
 * the homepage remains complete when optional CMS promotion rows are empty or
 * unavailable.
 */
export const RFZ_PUBLIC_ASSETS = {
  logo: 'https://res.cloudinary.com/dex5ykrfs/image/upload/v1792987471/file_00000000a3c082078081a735ed68ce28_tnzc5h.png',
  mlbbLogo: '/assets/runfazone/mlbb.webp',
  heroBanners: [
    '/assets/runfazone/banner-01.webp',
    '/assets/runfazone/banner-02.webp',
    '/assets/runfazone/banner-03.webp',
  ],
} as const;

export const RFZ_IMAGE_PRESETS = [
  { label: 'RunFazone banner 01', url: RFZ_PUBLIC_ASSETS.heroBanners[0] },
  { label: 'RunFazone banner 02', url: RFZ_PUBLIC_ASSETS.heroBanners[1] },
  { label: 'RunFazone banner 03', url: RFZ_PUBLIC_ASSETS.heroBanners[2] },
  { label: 'Mobile Legends icon', url: RFZ_PUBLIC_ASSETS.mlbbLogo },
] as const;

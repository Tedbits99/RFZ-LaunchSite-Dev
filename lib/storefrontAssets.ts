export const RFZ_PUBLIC_ASSETS = {
  logo: '/assets/runfazone/logo.webp',
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

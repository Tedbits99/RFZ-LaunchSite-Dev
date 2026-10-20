import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://runfazone.com';
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/track-order`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.4 },
  ];
}

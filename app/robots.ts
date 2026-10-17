import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://runfazone.com';
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/account', '/api', '/secure-admin-login'] }], sitemap: `${base}/sitemap.xml` };
}

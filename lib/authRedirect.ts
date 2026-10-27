const callbackPath = '/auth/callback';

/** Accept only a same-origin, root-relative destination suitable for router navigation. */
export function getSafeInternalPath(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c)/i.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://runfazone.invalid');
    if (url.origin !== 'https://runfazone.invalid' || !url.pathname.startsWith('/') || url.pathname.startsWith('//')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function getCustomerLoginUrl(destination: unknown): string {
  return `/login?next=${encodeURIComponent(getSafeInternalPath(destination))}`;
}

export function getConfiguredAppOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAuthCallbackUrl(): string | null {
  const origin = getConfiguredAppOrigin();
  return origin ? `${origin}${callbackPath}` : null;
}

export function getConfirmationUrl(status: 'success' | 'pending' | 'restricted' | 'invalid' | 'error'): string | null {
  const origin = getConfiguredAppOrigin();
  return origin ? `${origin}/auth/confirmation?status=${status}` : null;
}

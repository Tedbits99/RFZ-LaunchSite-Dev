const callbackPath = '/auth/callback';
const recoveryCallbackQuery = '?type=recovery';

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

/**
 * The only redirect target used for password recovery. Keeping this in the
 * trusted-origin module prevents callers from constructing a destination from
 * request headers or user-controlled `next` parameters.
 */
export function getPasswordRecoveryCallbackUrl(): string | null {
  const origin = getConfiguredAppOrigin();
  return origin ? `${origin}${callbackPath}${recoveryCallbackQuery}` : null;
}

export function getConfirmationUrl(status: 'success' | 'pending' | 'restricted' | 'invalid' | 'error'): string | null {
  const origin = getConfiguredAppOrigin();
  return origin ? `${origin}/auth/confirmation?status=${status}` : null;
}

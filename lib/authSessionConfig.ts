export const CUSTOMER_SESSION_COOKIE = 'rfz-customer-auth';
export const ADMIN_SESSION_COOKIE = 'rfz-admin-auth';
export const RECOVERY_SESSION_COOKIE = 'rfz-recovery-auth';

export const AUTH_SESSION_COOKIES = {
  customer: CUSTOMER_SESSION_COOKIE,
  admin: ADMIN_SESSION_COOKIE,
  recovery: RECOVERY_SESSION_COOKIE,
} as const;

export type AuthSessionContext = keyof typeof AUTH_SESSION_COOKIES;

export function sessionCookieName(context: AuthSessionContext): string {
  return AUTH_SESSION_COOKIES[context];
}

// Short-lived marker set by the auth callback ONLY after a successful
// recovery PKCE exchange with a resolved user. It is a completion guard for
// the reset page, not an authorization secret: without a recovery-namespace
// session it grants nothing, and it expires quickly.
export const RECOVERY_PROOF_COOKIE = 'rfz-recovery-proof';
export const RECOVERY_PROOF_MAX_AGE_SECONDS = 600;

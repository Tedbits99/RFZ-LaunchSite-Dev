export const CUSTOMER_SESSION_COOKIE = 'rfz-customer-auth';
export const ADMIN_SESSION_COOKIE = 'rfz-admin-auth';

export const AUTH_SESSION_COOKIES = {
  customer: CUSTOMER_SESSION_COOKIE,
  admin: ADMIN_SESSION_COOKIE,
} as const;

export type AuthSessionContext = keyof typeof AUTH_SESSION_COOKIES;

export function sessionCookieName(context: AuthSessionContext): string {
  return AUTH_SESSION_COOKIES[context];
}

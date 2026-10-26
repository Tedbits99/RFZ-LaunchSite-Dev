import { describe, expect, it } from 'vitest';
import { config } from '../proxy';

describe('Cloudflare low-CPU public-shell routing', () => {
  const expression = config.matcher[0];
  const matches = (route: string) => new RegExp(`^${expression}$`).test(route);

  it('avoids expensive middleware on public prerendered homepage and admin login', () => {
    expect(matches('/')).toBe(false);
    expect(matches('/secure-admin-login')).toBe(false);
    expect(matches('/secure-admin-login/')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
    expect(matches('/_next/static/css/main.css')).toBe(false);
  });

  it.each([
    '/admin', '/admin/notifications', '/account', '/account/orders',
    '/checkout', '/api/admin/orders', '/api/auth/login',
    '/auth/callback', '/auth/reset-password/complete',
    '/games/mobile-legends',
  ])('preserves auth proxy on dynamic/protected route %s', (route) => {
    expect(matches(route)).toBe(true);
  });

  it('does not inadvertently exempt a similarly prefixed protected path', () => {
    expect(matches('/secure-admin-login-extra')).toBe(true);
    expect(matches('/secure-admin-login-evil/path')).toBe(true);
  });
});

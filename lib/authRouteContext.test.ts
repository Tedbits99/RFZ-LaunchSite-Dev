import { describe, expect, it } from 'vitest';
import { resolveAuthRouteContext } from '@/lib/authRouteContext';

describe('resolveAuthRouteContext', () => {
  it.each([
    ['/admin', 'admin'],
    ['/admin/orders', 'admin'],
    ['/api/admin/orders/123', 'admin'],
    ['/secure-admin-login?from=logout', 'admin'],
    ['/api/promotions', 'admin'],
    ['/api/payment-config', 'admin'],
    ['/api/export?format=csv', 'admin'],
    ['/api/games/123', 'admin'],
    ['/api/suppliers/actions', 'admin'],
    ['/api/vouchers', 'admin'],
    ['/api/announcement', 'admin'],
  ] as const)('classifies admin path %s as %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });

  it.each([
    ['/account', 'customer'],
    ['/account/orders/123?tab=timeline', 'customer'],
    ['/login', 'customer'],
    ['/api/auth/register', 'customer'],
    ['/auth/callback?code=synthetic', 'customer'],
    ['/auth/customer/callback?code=synthetic', 'customer'],
  ] as const)('classifies customer path %s as %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });

  it.each([
    ['/checkout?ref=RF-ABC123', 'public'],
    ['/track-order', 'public'],
    ['/api/orders/access/request', 'public'],
    ['/api/orders/access/verify', 'public'],
    ['/api/orders/lookup?ref=RF-ABC123', 'public'],
    ['/api/orders/123/status-check', 'public'],
    ['/api/orders/123/timeline', 'public'],
    ['/api/orders/create-payment', 'public'],
    ['/api/orders/create-qrph-payment', 'public'],
    ['/api/orders/qrph-status', 'public'],
    ['/api/orders/submit-payment', 'public'],
  ] as const)('classifies guest-capability path %s as %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });

  it.each([
    ['/api/orders', 'mixed'],
    ['/api/orders/', 'mixed'],
    ['/api/orders/unknown-action', 'mixed'],
  ] as const)('classifies mixed order path %s as %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });

  it.each([
    ['/api/webhooks/payment', 'service/internal'],
    ['/api/internal/reconcile', 'service/internal'],
  ] as const)('classifies service path %s as %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });

  it.each([
    ['/administrator', 'public'],
    ['/administer', 'public'],
    ['/api/administer/orders', 'public'],
    ['/accounting', 'public'],
    ['/not-a-real-route?next=/admin', 'public'],
    ['', 'public'],
    ['https://example.invalid/account/orders?x=1', 'customer'],
  ] as const)('does not overmatch %s', (path, expected) => {
    expect(resolveAuthRouteContext(path)).toBe(expected);
  });
});

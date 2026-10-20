import { isActiveAdmin, mayCreateSupplierOrder, mayUseServiceCredential } from './authorization.ts';

Deno.test('only active super admins may place supplier test orders', () => {
  if (!mayCreateSupplierOrder({ role: 'SUPER_ADMIN', is_active: true })) throw new Error('active super admin must be allowed');
  if (mayCreateSupplierOrder({ role: 'ADMIN', is_active: true })) throw new Error('ordinary admin must be denied');
  if (mayCreateSupplierOrder({ role: 'SUPER_ADMIN', is_active: false })) throw new Error('inactive super admin must be denied');
  if (isActiveAdmin(null)) throw new Error('missing admin row must be denied');
});

Deno.test('service credential may not place supplier test orders', () => {
  if (!mayUseServiceCredential(false)) throw new Error('server read/sync request should be allowed');
  if (mayUseServiceCredential(true)) throw new Error('service credential must not authorize a supplier order');
});

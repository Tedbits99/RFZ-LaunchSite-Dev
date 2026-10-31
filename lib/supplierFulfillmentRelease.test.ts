import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupplierFulfillmentReleased } from './supplierFulfillmentRelease';
import { isSupplierFulfillmentReleased as isEdgeSupplierFulfillmentReleased } from '../supabase/functions/_shared/supplierFulfillmentRelease';
import { startFulfillment, fulfillOrder } from './suppliers/fulfillment';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('supplier fulfillment release lock', () => {
  it('fails closed when unset or set to any other value', () => {
    expect(isSupplierFulfillmentReleased(undefined)).toBe(false);
    expect(isSupplierFulfillmentReleased('')).toBe(false);
    expect(isSupplierFulfillmentReleased('true')).toBe(false);
    expect(isSupplierFulfillmentReleased('ENABLED')).toBe(false);
  });

  it('requires the exact explicit release value', () => {
    expect(isSupplierFulfillmentReleased('enabled')).toBe(true);
  });

  it.each([undefined, '', 'true', 'ENABLED', ' enabled ', 'enabled'])('keeps Node and Edge release decisions consistent for %s', (value) => {
    expect(isEdgeSupplierFulfillmentReleased(value)).toBe(isSupplierFulfillmentReleased(value));
  });

  it.each([undefined, 'false', 'true', 'ENABLED'])('blocks normal and admin/retry fulfillment before database or HTTP access for %s', async (value) => {
    vi.stubEnv('RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE', value);
    const from = vi.fn(() => { throw new Error('database access must remain blocked'); });
    const fetch = vi.fn(() => { throw new Error('HTTP access must remain blocked'); });
    vi.stubGlobal('fetch', fetch);
    const db = { from };
    await expect(startFulfillment('synthetic-order', db)).resolves.toMatchObject({ success: false, error: 'Supplier fulfillment is disabled' });
    await expect(fulfillOrder('synthetic-order', 'synthetic-package', 'synthetic-player', undefined, db))
      .resolves.toMatchObject({ success: false, error: 'Supplier fulfillment is disabled' });
    expect(from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

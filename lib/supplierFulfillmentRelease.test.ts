import { describe, expect, it } from 'vitest';
import { isSupplierFulfillmentReleased } from './supplierFulfillmentRelease';

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
});

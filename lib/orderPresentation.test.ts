import { describe, expect, it } from 'vitest';
import { getOrderPresentation } from './orderPresentation';

describe('getOrderPresentation', () => {
  it('keeps payment and fulfillment states distinct', () => {
    expect(getOrderPresentation('WAITING_PAYMENT').label).toBe('Waiting for payment');
    expect(getOrderPresentation('PROCESSING').label).toBe('Processing');
    expect(getOrderPresentation('FAILED').label).toBe('Failed');
    expect(getOrderPresentation('CANCELLED').label).toBe('Cancelled');
  });

  it('provides a safe recovery state for an unknown or missing status', () => {
    expect(getOrderPresentation('')).toMatchObject({ label: 'Status unavailable', terminal: false });
    expect(getOrderPresentation('UNKNOWN').message).toContain('checking');
  });
});

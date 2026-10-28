import { describe, expect, it } from 'vitest';
import { isTopupStatus, TOPUP_STATUS_COPY } from './walletTopupStatus';

describe('customer wallet top-up status copy', () => {
  it('provides explicit safe messaging for each payment and refund state', () => {
    for (const status of ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED']) {
      expect(TOPUP_STATUS_COPY[status as keyof typeof TOPUP_STATUS_COPY].title.length).toBeGreaterThan(0);
      expect(TOPUP_STATUS_COPY[status as keyof typeof TOPUP_STATUS_COPY].message.length).toBeGreaterThan(20);
    }
    expect(TOPUP_STATUS_COPY.PENDING.message).toMatch(/signed payment webhook/i);
    expect(TOPUP_STATUS_COPY.FAILED.message).toMatch(/No wallet credit/i);
    expect(TOPUP_STATUS_COPY.EXPIRED.message).toMatch(/No wallet credit/i);
  });

  it('rejects unknown and inherited object properties', () => {
    expect(isTopupStatus('PENDING')).toBe(true);
    expect(isTopupStatus('PAID')).toBe(true);
    expect(isTopupStatus('MAGICALLY_PAID')).toBe(false);
    expect(isTopupStatus('toString')).toBe(false);
    expect(isTopupStatus(null)).toBe(false);
  });
});

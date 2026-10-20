import { describe, expect, it } from 'vitest';
import {
  hasValidReconciliationSecret,
  getReconciliationDecision,
  isInFlightSupplierTransactionStatus,
  isEnabledFazerCardsSupplier,
} from './reconciliationSecurity';

describe('reconciliation scheduler authentication', () => {
  it('fails closed for missing or incorrect secrets', () => {
    const expected = Array.from({ length: 32 }, (_, index) => String.fromCharCode(65 + (index % 26))).join('');

    expect(hasValidReconciliationSecret(null, expected)).toBe(false);
    expect(hasValidReconciliationSecret('', expected)).toBe(false);
    expect(hasValidReconciliationSecret('wrong', expected)).toBe(false);
    expect(hasValidReconciliationSecret(expected, null)).toBe(false);
    expect(hasValidReconciliationSecret(expected, '')).toBe(false);
  });

  it('accepts the scheduler secret when it matches the protected value', () => {
    const expected = Array.from({ length: 32 }, (_, index) => String.fromCharCode(65 + (index % 26))).join('');
    expect(hasValidReconciliationSecret(expected, expected)).toBe(true);
  });
});

describe('FazerCards-only reconciliation guard', () => {
  it('accepts only an enabled FazerCards custom adapter', () => {
    expect(isEnabledFazerCardsSupplier({ code: 'fazercards', adapter: 'custom', enabled: true })).toBe(true);
    expect(isEnabledFazerCardsSupplier({ code: 'fazercards', adapter: 'custom', enabled: false })).toBe(false);
    expect(isEnabledFazerCardsSupplier({ code: 'other', adapter: 'custom', enabled: true })).toBe(false);
    expect(isEnabledFazerCardsSupplier({ code: 'fazercards', adapter: 'generic', enabled: true })).toBe(false);
  });

  it('polls only submitted or pending transactions', () => {
    expect(isInFlightSupplierTransactionStatus('submitted')).toBe(true);
    expect(isInFlightSupplierTransactionStatus('pending')).toBe(true);
    expect(isInFlightSupplierTransactionStatus('success')).toBe(false);
    expect(isInFlightSupplierTransactionStatus('failed')).toBe(false);
  });

  it('requires explicit supplier failure details and keeps ambiguous results pending', () => {
    expect(getReconciliationDecision('completed', null)).toBe('completed');
    expect(getReconciliationDecision('success', null)).toBe('completed');
    expect(getReconciliationDecision('failed', 'supplier rejected the order')).toBe('failed');
    expect(getReconciliationDecision('error', '')).toBe('processing');
    expect(getReconciliationDecision('pending', null)).toBe('processing');
  });
});

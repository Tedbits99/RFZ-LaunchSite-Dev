import { describe, expect, it } from 'vitest';
import { isOrderOwner, normalizeOrderEmail } from './orderAccess';

describe('order ownership policy', () => {
  it('normalizes valid emails for exact database matching', () => {
    expect(normalizeOrderEmail('  Customer@Example.COM ')).toBe('customer@example.com');
  });

  it('rejects missing, non-string, and oversized ownership proofs', () => {
    expect(normalizeOrderEmail(undefined)).toBeNull();
    expect(normalizeOrderEmail('')).toBeNull();
    expect(normalizeOrderEmail(123)).toBeNull();
    expect(normalizeOrderEmail('a'.repeat(321))).toBeNull();
  });

  it('allows the matching customer and rejects another customer', () => {
    expect(isOrderOwner(' Customer@Example.COM ', 'customer@example.com')).toBe(true);
    expect(isOrderOwner('other@example.com', 'customer@example.com')).toBe(false);
  });

  it('fails closed when either side is missing', () => {
    expect(isOrderOwner(undefined, 'customer@example.com')).toBe(false);
    expect(isOrderOwner('customer@example.com', undefined)).toBe(false);
  });
});

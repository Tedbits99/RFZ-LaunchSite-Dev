import { describe, expect, it } from 'vitest';
import { coinsForCents } from './rfCoins';

describe('RF Coins integer-centavo pricing', () => {
  it('uses the provided database rate rather than assuming one peso per coin', () => {
    expect(coinsForCents(10_000, 250)).toBe(40);
    expect(coinsForCents(10_000, 125)).toBe(80);
  });

  it('rounds fractional coin requirements up exactly from integer centavos', () => {
    expect(coinsForCents(10_001, 250)).toBe(41);
    expect(coinsForCents(2_501, 250)).toBe(11);
  });

  it('prices the final discounted voucher total, not the undiscounted package subtotal', () => {
    const packageSubtotalCents = 12_999;
    const voucherDiscountCents = 2_000;
    const finalOrderTotalCents = packageSubtotalCents - voucherDiscountCents;

    expect(coinsForCents(finalOrderTotalCents, 250)).toBe(44);
    expect(coinsForCents(packageSubtotalCents, 250)).toBe(52);
  });

  it.each([
    [0, 100], [-1, 100], [1.5, 100], [Number.NaN, 100], [Number.POSITIVE_INFINITY, 100],
    [100, 0], [100, -1], [100, 2.5], [100, Number.NaN], [Number.MAX_SAFE_INTEGER + 1, 1],
  ])('rejects invalid or unsafe pricing input (%s, %s)', (amount, rate) => {
    expect(coinsForCents(amount, rate)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeCampaignDiscount,
  formatCampaignDate,
  isValidCampaignCode,
  parseMoneyCents,
  zonedDateTimeToIso,
} from './voucherCampaign';

describe('voucher campaign safety helpers', () => {
  it('parses PHP cents without float drift and rejects malformed amounts', () => {
    expect(parseMoneyCents('120.05')).toBe(12005);
    expect(parseMoneyCents('0.9')).toBe(90);
    expect(parseMoneyCents('1.009')).toBeNull();
    expect(parseMoneyCents('-1')).toBeNull();
  });

  it('normalizes and strictly validates campaign codes', () => {
    expect(isValidCampaignCode(' rfz-sale-10 ')).toBe(true);
    expect(isValidCampaignCode('ab')).toBe(false);
    expect(isValidCampaignCode('CODE with spaces')).toBe(false);
  });

  it('keeps discount totals integer, capped, and above zero', () => {
    expect(computeCampaignDiscount(999, 'PERCENTAGE', 10, 50)).toEqual({ discountCents: 50, totalCents: 949 });
    expect(computeCampaignDiscount(100, 'FIXED', 100, null)).toBeNull();
    expect(computeCampaignDiscount(100, 'PERCENTAGE', 101, null)).toBeNull();
  });

  it('converts timezone-aware wall times and rejects nonexistent DST times', () => {
    expect(zonedDateTimeToIso('2026-12-01T12:00', 'Asia/Manila')).toBe('2026-12-01T04:00:00.000Z');
    expect(zonedDateTimeToIso('2026-03-08T02:30', 'America/New_York')).toBeNull();
    expect(zonedDateTimeToIso('2026-12-01T12:00', 'Not/AZone')).toBeNull();
  });

  it('formats schedule values in their campaign timezone', () => {
    expect(formatCampaignDate('2026-12-01T04:00:00.000Z', 'Asia/Manila')).toMatch(/Dec 1, 2026/);
  });
});

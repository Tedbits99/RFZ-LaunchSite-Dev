import { describe, expect, it } from 'vitest';
import { summarizeAccountOrders } from './accountOrderSummary';

describe('summarizeAccountOrders', () => {
  it('does not display an authoritative zero when either owner-scoped read fails', () => {
    expect(summarizeAccountOrders({
      recentOrders: [],
      exactOrderCount: 0,
      listError: true,
      countError: false,
    }).totalOrders).toBeNull();
    expect(summarizeAccountOrders({
      recentOrders: [],
      exactOrderCount: null,
      listError: false,
      countError: true,
    }).totalOrders).toBeNull();
  });

  it('keeps a real empty history at zero and only totals verified payments in the displayed sample', () => {
    expect(summarizeAccountOrders({
      recentOrders: [],
      exactOrderCount: 0,
      listError: false,
      countError: false,
    })).toEqual({ totalOrders: 0, recentVerifiedPaymentCents: 0 });
    expect(summarizeAccountOrders({
      recentOrders: [
        { payment_status: 'VERIFIED', total_cents: 1299 },
        { payment_status: 'PENDING', total_cents: 2500 },
        { payment_status: 'FAILED', total_cents: 500 },
      ],
      exactOrderCount: 3,
      listError: false,
      countError: false,
    })).toEqual({ totalOrders: 3, recentVerifiedPaymentCents: 1299 });
  });
});

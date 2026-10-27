import { describe, expect, it } from 'vitest';
import {
  extractPayMongoPaymentSnapshot,
  extractPayMongoProviderReference,
  payMongoPaymentMatchesSnapshot,
} from '../supabase/functions/_shared/paymongoWebhookValidation';

describe('PayMongo webhook payment snapshot validation', () => {
  it('extracts and normalizes amount and currency from a payment resource', () => {
    const snapshot = extractPayMongoPaymentSnapshot({ amount: 12500, currency: 'php' });
    expect(snapshot).toEqual({ amountCents: 12500, currency: 'PHP' });
    expect(payMongoPaymentMatchesSnapshot(snapshot, 12500, 'PHP')).toBe(true);
  });

  it('supports checkout-session events with nested payment values', () => {
    const snapshot = extractPayMongoPaymentSnapshot({
      payments: [{ id: 'pay_1', attributes: { amount: 2500, currency: 'PHP' } }],
    });
    expect(snapshot).toEqual({ amountCents: 2500, currency: 'PHP' });
    expect(extractPayMongoProviderReference('checkout_session.payment.paid', 'cs_1', {
      payments: [{ id: 'pay_1', attributes: { amount: 2500, currency: 'PHP' } }],
    })).toBe('cs_1');
  });

  it('uses the parent payment intent when a payment event provides one', () => {
    expect(extractPayMongoProviderReference('payment.paid', 'pay_1', {
      payment_intent_id: 'pi_1',
    })).toBe('pi_1');
    expect(extractPayMongoProviderReference('payment.paid', 'pay_1', {})).toBe('pay_1');
  });

  it.each([
    [{ amount: null, currency: 'PHP' }, 100, 'PHP'],
    [{ amount: '100', currency: 'PHP' }, 100, 'PHP'],
    [{ amount: 100, currency: null }, 100, 'PHP'],
    [{ amount: 99, currency: 'PHP' }, 100, 'PHP'],
    [{ amount: 100, currency: 'USD' }, 100, 'PHP'],
  ])('rejects missing, malformed, or mismatched provider values', (raw, expectedAmount, expectedCurrency) => {
    expect(payMongoPaymentMatchesSnapshot(
      extractPayMongoPaymentSnapshot(raw),
      expectedAmount,
      expectedCurrency,
    )).toBe(false);
  });

  it('rejects invalid persisted snapshots rather than coercing them', () => {
    const event = extractPayMongoPaymentSnapshot({ amount: 100, currency: 'PHP' });
    expect(payMongoPaymentMatchesSnapshot(event, '100', 'PHP')).toBe(false);
    expect(payMongoPaymentMatchesSnapshot(event, 100, 'P')).toBe(false);
  });
});

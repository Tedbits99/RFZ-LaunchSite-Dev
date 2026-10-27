import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const webhookSource = readFileSync(
  new URL('../supabase/functions/payment-webhook/index.ts', import.meta.url),
  'utf8',
);
const topupSource = readFileSync(
  new URL('../supabase/functions/create-coin-topup-payment/index.ts', import.meta.url),
  'utf8',
);
const pendingCoinFunctions = readFileSync(
  new URL('../supabase/migrations-pending/20261018160100_rf_coins_functions.sql', import.meta.url),
  'utf8',
);

describe('PayMongo settlement fail-closed contract', () => {
  it('requires a persisted create-payment snapshot before product order verification', () => {
    const snapshotLookup = webhookSource.indexOf('.eq("action", "create")');
    const snapshotValidation = webhookSource.indexOf('payMongoPaymentMatchesSnapshot(', snapshotLookup);
    const verifyPayment = webhookSource.indexOf('supabase.rpc("verify_payment"');
    expect(snapshotLookup).toBeGreaterThan(-1);
    expect(snapshotValidation).toBeGreaterThan(snapshotLookup);
    expect(verifyPayment).toBeGreaterThan(snapshotValidation);
    expect(webhookSource).toContain('result.amountCents ?? 0');
    expect(webhookSource).toContain('currency: result.currency || matchedConfig.currency || "PHP"');
  });

  it('requires matching top-up amount, currency, and provider reference before crediting', () => {
    const topupValidation = webhookSource.indexOf('Top-up amount, currency, or payment reference mismatch');
    const creditRpc = webhookSource.indexOf('supabase.rpc("rf_coin_credit_paid_topup"');
    expect(topupValidation).toBeGreaterThan(-1);
    expect(creditRpc).toBeGreaterThan(topupValidation);
    expect(topupSource).toContain('currency,\n      status: "pending"');
    expect(pendingCoinFunctions).toContain('RF_COIN_PROVIDER_REFERENCE_MISMATCH');
  });
});

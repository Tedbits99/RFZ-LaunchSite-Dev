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
  new URL('../supabase/migrations/20261028120100_rf_coins_functions.sql', import.meta.url),
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
    expect(topupSource).toContain('currency,\n      status: "processing"');
    expect(topupSource.indexOf('status: "processing"')).toBeLessThan(
      topupSource.indexOf('const intentRes = await paymongoJson'),
    );
    expect(topupSource).toContain('status: "pending",\n        provider_reference: intentId');
    expect(pendingCoinFunctions).toContain('RF_COIN_PROVIDER_REFERENCE_MISMATCH');
  });

  it('locks the RF Coins PayMongo wallet-funding Edge Function before reading secrets or making provider calls', () => {
    const releaseLock = topupSource.indexOf('const RF_COINS_FUNDING_RELEASE_ENABLED = false;');
    const requestGate = topupSource.indexOf('if (!RF_COINS_FUNDING_RELEASE_ENABLED)');
    const firstSecretRead = topupSource.indexOf('Deno.env.get("SUPABASE_URL")');
    const providerCall = topupSource.indexOf('paymongoJson(PAYMONGO_SECRET');
    expect(releaseLock).toBeGreaterThan(-1);
    expect(requestGate).toBeGreaterThan(releaseLock);
    expect(firstSecretRead).toBeGreaterThan(requestGate);
    expect(providerCall).toBeGreaterThan(requestGate);
  });
});

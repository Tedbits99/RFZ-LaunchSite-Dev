import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasValidReconciliationSecret } from '../_shared/reconciliationSecurity';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function serveBlock(): string {
  const marker = 'Deno.serve';
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(0);
  return source.slice(start);
}

describe('fulfillment-handoff-v2 health-check safety contract', () => {
  it('registers the v2 config entry with JWT verification disabled', () => {
    const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
    const entry = config.match(/\[functions\.fulfillment-handoff-v2\]([^\[]*)/);
    expect(entry).not.toBeNull();
    expect(entry![1]).toContain('verify_jwt = false');
  });

  it('answers the health check only after the X-Cron-Secret validation', () => {
    const serve = serveBlock();
    const authIndex = serve.indexOf('hasValidReconciliationSecret(');
    const healthIndex = serve.indexOf('"health"');
    expect(authIndex).toBeGreaterThan(0);
    expect(healthIndex).toBeGreaterThan(authIndex);
  });

  it('health check returns HTTP 200, zero claims, and never claims the queue', () => {
    const serve = serveBlock();
    const healthStart = serve.indexOf('"health"');
    const claimRpcIndex = serve.indexOf('rf_coin_claim_fulfillment_handoffs');
    expect(claimRpcIndex).toBeGreaterThan(healthStart);
    expect(serve.slice(healthStart, claimRpcIndex)).toContain('claimed: 0');
    expect(serve.slice(healthStart, claimRpcIndex)).not.toContain('fetch(');
    expect(serve.slice(healthStart, claimRpcIndex)).not.toContain('supplier_transactions');
  });

  it('keeps the same cron secret key and constant-time comparator as the reviewed worker', () => {
    expect(source).toContain('"fulfillment_handoff_secret"');
    expect(source).toContain("hasValidReconciliationSecret(req.headers.get(\"X-Cron-Secret\"), configuredSecret)");
    expect(source).toContain('rf_coin_claim_fulfillment_handoffs');
    expect(source).toContain('rf_coin_ack_fulfillment_handoff');
  });
});

describe('health-check authentication matrix (shared comparator)', () => {
  const configured = 'cron-secret-aaaaaaaaaaaaaaaaaaaa';
  const header = (value: string | null) =>
    hasValidReconciliationSecret(value, configured);

  it('accepts only the exact configured secret', () => {
    expect(header(configured)).toBe(true);
  });

  it.each([
    ['missing', null],
    ['empty', ''],
    ['wrong value', 'cron-secret-bbbbbbbbbbbbbbbbbbbb'],
    ['prefix', configured.slice(0, -1)],
    ['extension', configured + 'x'],
  ] as [string, string | null][])('rejects %s header before any queue or supplier action', (_label, value) => {
    expect(header(value)).toBe(false);
  });
});

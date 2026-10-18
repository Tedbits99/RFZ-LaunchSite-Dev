import { createClient } from '@supabase/supabase-js';
import { request as httpRequest } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  FakeTransportFailure,
  runCompletionReceiptWorkerEngine,
  type ClaimedCompletionReceipt,
  type CompletionReceiptWorkerRpc,
} from './engine.ts';
import type { CompletionReceiptMessage, CompletionReceiptTransport } from '../transportContract.ts';

const mode = process.env.RFZ_COMPLETION_RECEIPT_INTEGRATION_MODE;
const apiUrl = process.env.RFZ_DISPOSABLE_SUPABASE_API_URL;
const serviceRoleKey = process.env.RFZ_DISPOSABLE_SUPABASE_SERVICE_ROLE_KEY;
const integrationRequested = mode !== undefined || apiUrl !== undefined || serviceRoleKey !== undefined;

function normalizedLocalApiOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:'
      || url.hostname !== '127.0.0.1'
      || url.port !== process.env.RFZ_DISPOSABLE_SUPABASE_API_PORT
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasAmbientProxyConfiguration(): boolean {
  return [
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
    'npm_config_proxy', 'NPM_CONFIG_PROXY', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY',
  ]
    .some((name) => process.env[name] !== undefined);
}

/** Direct Node HTTP socket to literal loopback: no proxy agent, DNS, or redirects. */
function createLoopbackOnlyFetch(approvedOrigin: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: URL;
    try {
      const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      url = new URL(raw, approvedOrigin);
    } catch {
      throw new Error('Disposable RPC request URL is malformed.');
    }
    if (url.origin !== approvedOrigin || url.username || url.password
      || url.hash || !url.pathname.startsWith('/rest/v1/rpc/')) {
      throw new Error('Disposable RPC request destination rejected.');
    }

    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? 'GET';
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const body = init?.body ?? request?.body ?? undefined;
    if (body !== undefined && typeof body !== 'string') {
      throw new Error('Disposable RPC request body type rejected.');
    }
    const bodyBytes = typeof body === 'string' ? Buffer.from(body) : undefined;

    return await new Promise<Response>((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1',
        port: Number(url.port),
        method,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
        agent: false,
        timeout: 10_000,
      }, (res) => {
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
          res.resume();
          reject(new Error('Disposable RPC redirect rejected.'));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), {
          status: res.statusCode ?? 500,
          statusText: res.statusMessage,
          headers: res.headers as HeadersInit,
        })));
      });
      req.on('timeout', () => req.destroy(new Error('Disposable RPC timed out.')));
      req.on('error', reject);
      if (bodyBytes) req.write(bodyBytes);
      req.end();
    });
  };
}

function isDisposableServiceRoleJwt(value: string | undefined): value is string {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = base64Payload.padEnd(base64Payload.length + ((4 - base64Payload.length % 4) % 4), '=');
    const payload = JSON.parse(atob(paddedPayload));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

describe.skipIf(!integrationRequested)('disposable PostgreSQL worker-engine integration', () => {
  it('uses real local E5.2 claim/ack RPCs with deterministic fake delivery only', async () => {
    expect(mode).toBe('disposable');
    const approvedOrigin = normalizedLocalApiOrigin(apiUrl);
    expect(approvedOrigin).not.toBeNull();
    expect(isDisposableServiceRoleJwt(serviceRoleKey)).toBe(true);
    expect(hasAmbientProxyConfiguration()).toBe(false);
    if (!approvedOrigin || !serviceRoleKey || !isDisposableServiceRoleJwt(serviceRoleKey)
      || hasAmbientProxyConfiguration()) {
      throw new Error('Disposable integration requires a loopback Supabase API and local service-role test key.');
    }

    const client = createClient(approvedOrigin, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: createLoopbackOnlyFetch(approvedOrigin) },
    });
    const rpc: CompletionReceiptWorkerRpc = {
      async claim(limit, leaseSeconds) {
        const { data, error } = await client.rpc('claim_completion_receipt_outbox', {
          p_limit: limit,
          p_lease_seconds: leaseSeconds,
        });
        if (error) throw new Error('Disposable claim RPC failed.');
        return (data ?? []) as ClaimedCompletionReceipt[];
      },
      async acknowledge(id, leaseToken, providerMessageId) {
        const { data, error } = await client.rpc('ack_completion_receipt_sent', {
          p_id: id,
          p_lease_token: leaseToken,
          p_provider_message_id: providerMessageId ?? null,
        });
        if (error) throw new Error('Disposable acknowledgment RPC failed.');
        return data === true;
      },
      async fail(id, leaseToken, category) {
        const { data, error } = await client.rpc('fail_completion_receipt_outbox', {
          p_id: id,
          p_lease_token: leaseToken,
          p_error: category,
        });
        if (error) throw new Error('Disposable failure RPC failed.');
        const result = Array.isArray(data) ? data[0] : data;
        if (!result || typeof result.out_status !== 'string') {
          throw new Error('Disposable failure RPC returned an invalid result.');
        }
        return result as { out_status: string; out_next_attempt_at: string | null };
      },
    };

    const deliveries: CompletionReceiptMessage[] = [];
    const acknowledgedFixtureIds: string[] = [];
    const failedFixtureIds: string[] = [];
    const claimedLeaseTokens = new Map<string, string>();
    const claimIdentityByRecipient = new Map<string, string>();
    const fakeTransport: CompletionReceiptTransport = {
      async send(message) {
        deliveries.push(message);
        if (message.recipient === 'worker-3@example.invalid') {
          throw new FakeTransportFailure('TIMEOUT');
        }
      },
    };

    const observedRpc: CompletionReceiptWorkerRpc = {
      async claim(limit, leaseSeconds) {
        const rows = await rpc.claim(limit, leaseSeconds);
        expect(rows.map((row) => row.out_id).sort()).toEqual([
          '00000000-0000-0000-0000-000000000609',
          '00000000-0000-0000-0000-000000000610',
        ]);
        for (const row of rows) {
          claimedLeaseTokens.set(row.out_id, row.out_lease_token);
          claimIdentityByRecipient.set(row.out_recipient_email, row.out_id);
        }
        expect(claimIdentityByRecipient.get('worker-2@example.invalid'))
          .toBe('00000000-0000-0000-0000-000000000609');
        expect(claimIdentityByRecipient.get('worker-3@example.invalid'))
          .toBe('00000000-0000-0000-0000-000000000610');
        return rows;
      },
      async acknowledge(id, token, providerId) {
        acknowledgedFixtureIds.push(id);
        expect(token).toBe(claimedLeaseTokens.get(id));
        expect(providerId).toBeNull();
        return rpc.acknowledge(id, token, providerId);
      },
      async fail(id, token, category) {
        failedFixtureIds.push(id);
        expect(token).toBe(claimedLeaseTokens.get(id));
        expect(category).toBe('TIMEOUT');
        return rpc.fail(id, token, category);
      },
    };
    const result = await runCompletionReceiptWorkerEngine({ rpc: observedRpc, transport: fakeTransport }, 'https://runfazone.example', 2);

    expect(result).toMatchObject({
      claimed: 2,
      fakeDeliveries: 1,
      acknowledged: 1,
      retryScheduled: 1,
      errors: 0,
    });
    expect(deliveries).toHaveLength(2);
    const successfulDelivery = deliveries.find((message) => message.recipient === 'worker-2@example.invalid');
    const failedDelivery = deliveries.find((message) => message.recipient === 'worker-3@example.invalid');
    expect(successfulDelivery?.subject).toContain('RF-OUTBOX-WORKER-2');
    expect(successfulDelivery?.html).toContain('/track-order?ref=RF-OUTBOX-WORKER-2');
    expect(failedDelivery?.subject).toContain('RF-OUTBOX-WORKER-3');
    expect(acknowledgedFixtureIds).toEqual(['00000000-0000-0000-0000-000000000609']);
    expect(failedFixtureIds).toEqual(['00000000-0000-0000-0000-000000000610']);
    // E5.2 retries INVALID_RECIPIENT and other failure categories according
    // to attempt count; it does not immediately dead-letter permanent categories.
    // E5.3B intentionally leaves that established RPC policy unchanged.
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ConfirmationPage from './page';
import {
  GENERIC_SENT,
  requestConfirmationResend,
  type ResendOutcome,
} from './ResendConfirmationForm';

const sourcePath = join(__dirname, 'page.tsx');
const source = readFileSync(join(__dirname, 'ResendConfirmationForm.tsx'), 'utf8');

const STATUS_MESSAGES: Record<string, { title: string; detail: string }> = {
  success: { title: 'Email confirmed', detail: 'Your customer account is ready. You can return to the store.' },
  pending: { title: 'Account still pending', detail: 'This account is not ready for access yet. Request a fresh confirmation email if needed.' },
  restricted: { title: 'Account access restricted', detail: 'This confirmation link cannot change the current account status.' },
  invalid: { title: 'Confirmation link unavailable', detail: 'This link is invalid, expired, or has already been used.' },
  error: { title: 'Confirmation unavailable', detail: 'We could not complete confirmation right now. Please try again later.' },
};

async function renderWithStatus(status?: string): Promise<string> {
  const page = await ConfirmationPage({ searchParams: status ? Promise.resolve({ status }) : undefined });
  return renderToString(page);
}

describe('confirmation page status rendering (SSR)', () => {
  it('renders all five status messages intact', async () => {
    for (const [key, message] of Object.entries(STATUS_MESSAGES)) {
      const html = await renderWithStatus(key);
      expect(html).toContain(message.title);
      expect(html).toContain(message.detail);
    }
  });

  it('shows the resend form for the pending status only', async () => {
    expect(await renderWithStatus('pending')).toContain('Resend confirmation email');
  });

  it('shows the resend form for the invalid status only', async () => {
    expect(await renderWithStatus('invalid')).toContain('Resend confirmation email');
  });

  it('does not show the resend form for success, restricted, or error', async () => {
    expect(await renderWithStatus('success')).not.toContain('Resend confirmation email');
    expect(await renderWithStatus('restricted')).not.toContain('Resend confirmation email');
    expect(await renderWithStatus('error')).not.toContain('Resend confirmation email');
  });

  it('preserves the return-to-store navigation', async () => {
    expect(await renderWithStatus('pending')).toContain('Return to store');
  });

  it('takes a confirmed customer directly to the protected account hub', async () => {
    const html = await renderWithStatus('success');
    expect(html).toContain('Open my account');
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('href="/"');
  });
});

describe('resend form source invariants (static checks)', () => {
  it('posts JSON to the exact existing API endpoint', () => {
    expect(source).toContain("'/api/auth/resend-confirmation'");
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("headers: { 'Content-Type': 'application/json' }");
    expect(source).toContain('JSON.stringify({ email: normalized })');
  });

  it('uses same-origin credentials and prevents native navigation', () => {
    expect(source).toContain("credentials: 'same-origin'");
    expect(source).not.toMatch(/action=|method="POST"|window\.location/);
  });

  it('never logs emails, tokens, or secrets', () => {
    expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
  });
});

function mockFetchOnce(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('requestConfirmationResend (mocked fetch branch tests)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the exact endpoint, method, JSON body and content type', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.body).toBe(JSON.stringify({ email: 'customer@example.com' }));
      return new Response(null, { status: 202 });
    });
    const outcome = await requestConfirmationResend('  Customer@Example.COM  ', fetchMock as unknown as typeof fetch);
    expect(outcome).toEqual({ kind: 'sent' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/resend-confirmation');
  });

  it('rejects invalid, oversized and non-string emails locally without calling the API', async () => {
    const fetchMock = vi.fn();
    for (const email of ['not-an-email', '', '   ', `${'a'.repeat(311)}@example.com`, 42, null, undefined]) {
      const outcome = await requestConfirmationResend(email, fetchMock as unknown as typeof fetch);
      expect(outcome).toEqual({ kind: 'invalid-email' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps HTTP 400 to email-validation feedback', async () => {
    expect(await requestConfirmationResend('bad@example.com', mockFetchOnce(400)))
      .toEqual({ kind: 'invalid-email' });
  });

  it('maps HTTP 403 to a generic security error without retry', async () => {
    expect(await requestConfirmationResend('customer@example.com', mockFetchOnce(403)))
      .toEqual({ kind: 'security' });
  });

  it('maps HTTP 429 to rate-limit feedback with a validated wait hint', async () => {
    expect(await requestConfirmationResend('customer@example.com', mockFetchOnce(429, { retry_after_seconds: 45 })))
      .toEqual({ kind: 'rate-limited', retryAfterSeconds: 45 });
  });

  it('drops invalid wait hints from the 429 payload before display', async () => {
    for (const hint of ['30', -5, 999999, null]) {
      expect(await requestConfirmationResend('customer@example.com', mockFetchOnce(429, { retry_after_seconds: hint })))
        .toEqual({ kind: 'rate-limited', retryAfterSeconds: undefined });
    }
  });

  it('maps HTTP 503 and other unexpected statuses to temporary unavailability', async () => {
    expect(await requestConfirmationResend('customer@example.com', mockFetchOnce(503)))
      .toEqual({ kind: 'unavailable' });
    expect(await requestConfirmationResend('customer@example.com', mockFetchOnce(500)))
      .toEqual({ kind: 'unavailable' });
  });

  it('maps network failures to a manual-retry error', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    expect(await requestConfirmationResend('customer@example.com', failingFetch))
      .toEqual({ kind: 'network' });
  });

  it('never leaks response payloads or secrets', async () => {
    const fetchMock = mockFetchOnce(429, { retry_after_seconds: 45 });
    const outcome = await requestConfirmationResend('customer@example.com', fetchMock);
    expect(outcome).toEqual({ kind: 'rate-limited', retryAfterSeconds: 45 });
    expect(JSON.stringify(outcome)).not.toContain('email');
    expect(JSON.stringify(outcome)).not.toContain('customer@example.com');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { logAuthFlowFailure } from './authFlowDiagnostics';

describe('authentication flow diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs only the flow stage and a bounded status category, never provider details', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logAuthFlowFailure('password_recovery', 'email_request', {
      status: 429,
      code: 'sensitive_provider_code',
      message: 'private@example.test bearer token-secret',
    });

    expect(warn).toHaveBeenCalledWith('auth_flow_failure', {
      flow: 'password_recovery',
      stage: 'email_request',
      category: 'rate_limited',
      http_status: 429,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private@example.test');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('token-secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive_provider_code');
  });

  it('does not invent an HTTP status for an exception without one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logAuthFlowFailure('confirmation_resend', 'rate_limit_reservation', new Error('private detail'));

    expect(warn).toHaveBeenCalledWith('auth_flow_failure', {
      flow: 'confirmation_resend',
      stage: 'rate_limit_reservation',
      category: 'provider_error',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private detail');
  });
});

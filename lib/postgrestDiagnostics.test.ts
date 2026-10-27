import { afterEach, describe, expect, it, vi } from 'vitest';
import { logPostgrestQueryFailure } from './postgrestDiagnostics';

describe('sanitized PostgREST diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records safe status and code while excluding messages and identifiers', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logPostgrestQueryFailure('admin_dashboard_orders', {
      code: '42501',
      status: 403,
      message: 'permission denied for private@example.test order SECRET-REFERENCE',
    });

    expect(error).toHaveBeenCalledWith('postgrest_query_failure', {
      surface: 'admin_dashboard_orders',
      code: '42501',
      http_status: 403,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private@example.test');
    expect(JSON.stringify(error.mock.calls)).not.toContain('SECRET-REFERENCE');
  });

  it('does not serialize malformed provider metadata', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logPostgrestQueryFailure('customer_orders', { code: 'secret value', status: 200, message: 'private detail' });

    expect(error).toHaveBeenCalledWith('postgrest_query_failure', { surface: 'customer_orders' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private detail');
  });
});

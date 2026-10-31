import { describe, expect, it } from 'vitest';
import { disabledFazerCardsDiagnosticResponse } from './disabledResponse';

describe('FazerCards diagnostic endpoint response', () => {
  it('fails closed with a stable response and no provider details', async () => {
    const response = disabledFazerCardsDiagnosticResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'FazerCards diagnostics are disabled; no provider request was made.',
    });
  });
});

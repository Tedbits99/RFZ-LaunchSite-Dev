import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  createCustomerServerClient: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: mocks.createCustomerServerClient,
}));

import { GET, POST } from './route';

const origin = 'https://example.test';

function request(includeOrigin = true) {
  return new NextRequest(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: includeOrigin ? { origin } : {},
  });
}

function browserRequest() {
  return new NextRequest(`${origin}/api/auth/logout`, {
    method: 'POST',
    headers: { origin, accept: 'text/html' },
  });
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createCustomerServerClient.mockReturnValue({ auth: { signOut: mocks.signOut } });
  });

  it('signs out only the customer namespace', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Signed out.' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('redirects browser form submissions after invalidating the session', async () => {
    const response = await POST(browserRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/login?from=logout`);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rejects missing or foreign origins', async () => {
    expect((await POST(request(false))).status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();

    const foreign = new NextRequest(`${origin}/api/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect((await POST(foreign)).status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('handles missing sessions and cleanup failures without exposing details', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { message: 'provider secret' } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.text()).toLowerCase()).not.toContain('provider secret');
    expect((await GET()).status).toBe(405);
  });
});

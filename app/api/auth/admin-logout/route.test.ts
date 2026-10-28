import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  createAdminServerClient: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createAdminServerClient: mocks.createAdminServerClient,
}));

import { GET, POST } from './route';

const origin = 'https://example.test';

function request(requestOrigin: string | null = origin) {
  return new NextRequest(`${origin}/api/auth/admin-logout`, {
    method: 'POST',
    headers: requestOrigin ? { origin: requestOrigin } : {},
  });
}

describe('POST /api/auth/admin-logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = origin;
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createAdminServerClient.mockResolvedValue({ auth: { signOut: mocks.signOut } });
  });

  it('clears only the server cookie-backed admin session', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ message: 'Signed out.' });
    expect(mocks.createAdminServerClient).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('rejects missing and foreign origins without touching Auth', async () => {
    expect((await POST(request(null))).status).toBe(403);
    expect((await POST(request('https://attacker.example'))).status).toBe(403);
    expect(mocks.createAdminServerClient).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('returns a generic failure if session cleanup fails', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { message: 'provider detail' } });
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('provider detail');
    expect((await GET()).status).toBe(405);
  });
});

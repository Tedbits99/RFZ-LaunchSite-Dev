import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const TEST_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
const USER_ID = 'admin-user-1';
const ACCESS_TOKEN = 'recovery-access-token';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createRecoveryServerClient: vi.fn(() => ({
    auth: {
      getSession: mocks.getSession,
      getUser: mocks.getUser,
    },
  })),
}));

import { GET, POST } from './route';

function session() {
  return {
    data: { session: { access_token: ACCESS_TOKEN, user: { id: USER_ID } } },
    error: null,
  };
}

function request(origin = 'https://example.test') {
  return new NextRequest('https://example.test/auth/reset-password/prepare', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
}

function setCookies(response: Response): string[] {
  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get('set-cookie') ?? ''];
}

describe('POST /auth/reset-password/prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    mocks.getSession.mockResolvedValue(session());
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it('refreshes the proof for the currently verified recovery session', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true });
    expect(mocks.getSession).toHaveBeenCalledTimes(2);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(setCookies(response).some((cookie) => cookie.startsWith('rfz-recovery-proof=') && cookie.includes('HttpOnly'))).toBe(true);
  });

  it('rejects a missing recovery session without issuing a proof', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(setCookies(response).some((cookie) => cookie.startsWith('rfz-recovery-proof=') && !cookie.includes('Max-Age=0'))).toBe(false);
  });

  it('rejects an untrusted origin before touching the recovery client', async () => {
    const response = await POST(request('https://evil.example'));

    expect(response.status).toBe(403);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('fails safely when the runtime signing secret is unavailable', async () => {
    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.getUser).toHaveBeenCalledOnce();
  });

  it('does not allow GET', async () => {
    expect((await GET()).status).toBe(405);
  });
});

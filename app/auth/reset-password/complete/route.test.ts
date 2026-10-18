import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

const TEST_SECRET = 'synthetic-test-secret-0123456789abcdef0123456789abcdef';
const USER_ID = 'customer-1';
const SESSION_ID = 'recovery-session-1';
const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createRecoveryServerClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
      getSession: mocks.getSession,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  })),
}));

import { POST } from './route';

function makeProof(opts: { userId?: string; sessionId?: string; exp?: number; secret?: string; breakSig?: boolean } = {}) {
  const claims = {
    token: 'a'.repeat(48),
    userId: opts.userId ?? USER_ID,
    sessionId: opts.sessionId ?? SESSION_ID,
    purpose: 'password-reset',
    exp: opts.exp ?? Math.floor(Date.now() / 1000) + 300,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', opts.secret ?? TEST_SECRET).update(payload, 'utf8').digest('base64url');
  return `${payload}.${opts.breakSig ? (sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`) : sig}`;
}

function postRequest(body: unknown, opts: { origin?: string | null; cookie?: string; contentType?: string } = {}) {
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/json',
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? 'https://example.test';
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest('http://request.invalid/auth/reset-password/complete', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function setCookies(response: Response): string[] {
  const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get('set-cookie') ?? ''];
}

const VALID_COOKIE = `rfz-recovery-proof=${makeProof()}`;

function validAuthMocks() {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.getSession.mockResolvedValue({ data: { session: { session_id: SESSION_ID } }, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
}

describe('POST /auth/reset-password/complete (server-verified password reset)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET = TEST_SECRET;
    validAuthMocks();
  });

  afterEach(() => {
    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;
  });

  it('a valid signed proof with a matching recovery user and session permits the update, signs out only recovery and clears the proof', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.updateUser).toHaveBeenCalledOnce();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });

    const cleared = setCookies(response).find((c) => c.startsWith('rfz-recovery-proof='));
    expect(cleared).toBeDefined();
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/auth/reset-password');
    expect(cleared).toContain('HttpOnly');
  });

  it('rejects a request with NO recovery proof cookie', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(GENERIC_INVALID);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ['garbage value', 'rfz-recovery-proof=not-a-proof'],
    ['wrong part count', 'rfz-recovery-proof=one.two.three'],
  ])('rejects a %s proof', async (_label, cookie) => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(setCookies(response).some((c) => c.startsWith('rfz-recovery-proof='))).toBe(false);
  });

  it('rejects a proof whose signature was modified', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${makeProof({ breakSig: true })}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a proof signed with a different secret', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${makeProof({ secret: 'another-secret-0123456789abcdef0123456789abcdef' })}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an expired proof', async () => {
    const expired = makeProof({ exp: Math.floor(Date.now() / 1000) - 10 });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${expired}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a proof bound to a different user (stolen proof cannot reset another account)', async () => {
    const stolen = makeProof({ userId: 'attacker-1' });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${stolen}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a proof bound to a different recovery session', async () => {
    const replayed = makeProof({ sessionId: 'other-session' });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${replayed}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a proof with the wrong purpose', async () => {
    const claims = {
      token: 'a'.repeat(48),
      userId: USER_ID,
      sessionId: SESSION_ID,
      purpose: 'email-change',
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const sig = createHmac('sha256', TEST_SECRET).update(payload, 'utf8').digest('base64url');
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: `rfz-recovery-proof=${payload}.${sig}` }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('fails closed when the signing secret is not configured', async () => {
    delete process.env.RFZ_RECOVERY_PROOF_HMAC_SECRET;
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects when the recovery namespace has no authenticated user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects when the recovery namespace has no session ID to bind against', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects an untrusted Origin header without touching the provider', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { origin: 'https://evil.example', cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a missing Origin header', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { origin: null, cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types', async () => {
    const response = await POST(postRequest('password=new-password-1', { contentType: 'application/x-www-form-urlencoded', cookie: VALID_COOKIE }));

    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await POST(postRequest('{not-json', { cookie: VALID_COOKIE }));

    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ['too short', 'short1a'],
    ['too long', 'a'.repeat(129)],
    ['missing', undefined],
    ['not a string', 12345],
  ])('rejects an invalid password (%s)', async (_label, password) => {
    const response = await POST(postRequest({ password }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('ignores forged identity fields: the reset target stays the verified recovery user', async () => {
    const response = await POST(
      postRequest({ password: 'new-password-1', user_id: 'attacker-1', email: 'attacker@example.test', role: 'admin', email_confirm: true }, { cookie: VALID_COOKIE }),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledOnce();
    const arg = mocks.updateUser.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg)).toEqual(['password']);
    expect(arg.password).toBe('new-password-1');
  });

  it('responds generically on provider errors and never leaks provider details', async () => {
    mocks.updateUser.mockResolvedValue({ data: null, error: { message: 'provider secret detail' } });
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));

    expect(response.status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect((await response.text())).not.toContain('provider secret detail');
  });

  it('GET is not allowed', async () => {
    const response = await POST(postRequest({ password: 'new-password-1' }, { cookie: VALID_COOKIE }));
    expect(response.status).not.toBe(405);

    const { GET } = await import('./route');
    const getResponse = await GET();
    expect(getResponse.status).toBe(405);
  });
});

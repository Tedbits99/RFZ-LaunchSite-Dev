import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  eq: vi.fn(),
  createCustomerServerClient: vi.fn(),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createCustomerServerClient: mocks.createCustomerServerClient,
}));

import { GET, PUT } from './route';

const origin = 'https://example.test';

function installChain() {
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  mocks.updateEq.mockResolvedValue({ error: null });
  mocks.createCustomerServerClient.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: mocks.eq,
      })),
      update: mocks.update,
    })),
  });
}

const activeUser = {
  id: 'customer-1',
  email: 'customer@example.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
};

describe('GET/PUT /api/account/profile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    installChain();
    mocks.getUser.mockResolvedValue({
      data: { user: activeUser },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { display_name: 'Juan', email_snapshot: 'customer@example.com', user_id: 'customer-1', status: 'active' },
      error: null,
    });
    mocks.update.mockReturnValue({ eq: mocks.updateEq });
  });

  it('returns the display name and masked email snapshot for the active session', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.display_name).toBe('Juan');
    expect(body.email).toBe('customer@example.com');
  });

  it('returns 401 when no active customer session exists', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'no session' } });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it('saves a valid display name through the RLS-restricted update', async () => {
    const req = new NextRequest(`${origin}/api/account/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: '  New Name  ' }),
    });
    const response = await PUT(req);
    expect(response.status).toBe(200);
  });

  it.each([
    null,
    42,
    { display_name: '' },
    { display_name: '   ' },
    { display_name: 'x'.repeat(121) },
    { display_name: 'bad\u0000name' },
  ])('rejects invalid profile payloads', async (body) => {
    const req = new NextRequest(`${origin}/api/account/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await PUT(req);
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('ignores forged ownership/status fields and only writes display_name', async () => {
    const req = new NextRequest(`${origin}/api/account/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'ok', status: 'suspended', user_id: 'other-user' }),
    });
    const response = await PUT(req);
    expect(response.status).toBe(200);
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({ display_name: 'ok' });
  });
});

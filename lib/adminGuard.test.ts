import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  })),
}));

vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: null }));
vi.mock('@/lib/supabaseServer', () => ({ createSupabaseServerClient: vi.fn() }));

import { getAdminSession, requireAdmin, resolveAdminSession } from './adminGuard';

const request = { cookies: { getAll: () => [], set: vi.fn() } } as unknown as NextRequest;

describe('requireAdmin authorization boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    mocks.getUser.mockReset();
    mocks.maybeSingle.mockReset();
  });

  it('returns 401 for unauthenticated requests', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 403 for an authenticated non-admin', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'customer-1', email: 'customer@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('returns the session and authenticated client for an authorized admin', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN', is_active: true }, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.userId).toBe('admin-1');
      expect(result.session.role).toBe('ADMIN');
    }
  });

  it('returns 403 for a suspended admin account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN', is_active: false }, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('resolves an active admin through the admin cookie client without a service-role lookup', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'SUPER_ADMIN', is_active: true }, error: null });

    const result = await resolveAdminSession();

    expect(result).toEqual({
      ok: true,
      session: { userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'SUPER_ADMIN' },
    });
    await expect(getAdminSession()).resolves.toMatchObject({ userId: 'admin-1', role: 'SUPER_ADMIN' });
  });

  it('distinguishes a valid Auth user without an admin record from an unavailable database', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'customer-1', email: 'customer@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(resolveAdminSession()).resolves.toEqual({ ok: false, reason: 'forbidden' });

    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'database unavailable' } });
    await expect(resolveAdminSession()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('treats an Auth session error as unauthenticated only for a missing or invalid token', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Auth session missing!' } });
    await expect(resolveAdminSession()).resolves.toEqual({ ok: false, reason: 'unauthenticated' });

    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'fetch failed' } });
    await expect(resolveAdminSession()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

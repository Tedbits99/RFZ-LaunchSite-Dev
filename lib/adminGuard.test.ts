import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  pageGetUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  })),
}));

vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: null }));
vi.mock('@/lib/supabaseServer', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.pageGetUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  })),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import { requireAdmin, requireAdminPageSession } from './adminGuard';

const request = { cookies: { getAll: () => [], set: vi.fn() } } as unknown as NextRequest;

describe('requireAdmin authorization boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    mocks.getUser.mockReset();
    mocks.maybeSingle.mockReset();
    mocks.pageGetUser.mockReset();
    mocks.notFound.mockClear();
  });

  it('returns 401 for unauthenticated requests', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it('returns 401 when Supabase rejects an expired or invalid session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'JWT expired' } });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
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

  it('denies an active admin whose role is not allowed for the requested boundary', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN', is_active: true }, error: null });
    const result = await requireAdmin(request, ['SUPER_ADMIN']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('blocks privileged page data access for anonymous and customer sessions', async () => {
    mocks.pageGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(requireAdminPageSession()).rejects.toThrow('NEXT_NOT_FOUND');

    mocks.pageGetUser.mockResolvedValueOnce({ data: { user: { id: 'customer-1', email: 'customer@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireAdminPageSession()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledTimes(2);
  });

  it('blocks inactive staff before privileged page data access', async () => {
    mocks.pageGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN', is_active: false }, error: null });
    await expect(requireAdminPageSession()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('blocks a valid staff session from a page restricted to administrators', async () => {
    mocks.pageGetUser.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'staff@example.com', name: 'Staff', role: 'STAFF', is_active: true }, error: null });
    await expect(requireAdminPageSession('ADMIN', 'SUPER_ADMIN')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('allows an active staff page session and preserves its role', async () => {
    mocks.pageGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@example.com' } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'STAFF', is_active: true }, error: null });
    await expect(requireAdminPageSession()).resolves.toMatchObject({ userId: 'admin-1', role: 'STAFF' });
  });
});

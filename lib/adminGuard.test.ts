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

import { requireAdmin } from './adminGuard';

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
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'admin@example.com', name: 'Admin', role: 'ADMIN' }, error: null });
    const result = await requireAdmin(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.userId).toBe('admin-1');
      expect(result.session.role).toBe('ADMIN');
    }
  });
});

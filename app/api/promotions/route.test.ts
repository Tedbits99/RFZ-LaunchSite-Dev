import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  adminFrom: vi.fn(),
  adminMaybeSingle: vi.fn(),
  adminEq: vi.fn(),
  permissionMaybeSingle: vi.fn(),
  promotionSelect: vi.fn(),
  promotionOrder: vi.fn(),
  anonymousFrom: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock('@/lib/authSessionClients', () => ({
  createAdminServerClient: vi.fn(),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: { from: mocks.adminFrom },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.anonymousFrom },
}));

import { GET, POST } from './route';

const adminUser = { id: 'synthetic-admin-id', email: 'admin@example.invalid' };
const adminRecord = { email: adminUser.email, name: 'Synthetic Admin', role: 'ADMIN', is_active: true };
const promotionRow = {
  id: 'promotion-1',
  title: 'Synthetic banner',
  body: 'Synthetic body',
  target_type: 'GLOBAL',
  game_id: null,
  package_id: null,
  image_url: 'https://example.invalid/banner.png',
  cta_text: 'View',
  cta_href: 'https://example.invalid/',
  starts_at: '2026-10-01T00:00:00.000Z',
  ends_at: null,
  is_active: false,
  sort_order: 3,
  placement: 'HOMEPAGE_HERO',
  target_game_id: null,
  internal_note: 'must never be serialized',
  created_at: '2026-10-01T00:00:00.000Z',
};

function request(url = 'http://localhost/api/promotions', headers?: HeadersInit) {
  return new NextRequest(url, { headers });
}

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/promotions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function configureDatabase() {
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === 'admins') {
      return {
        select: vi.fn(() => ({
          eq: mocks.adminEq,
        })),
      };
    }
    if (table === 'admin_role_permissions') {
      const query: Record<string, unknown> = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn(() => query);
      query.maybeSingle = mocks.permissionMaybeSingle;
      return query;
    }
    if (table === 'promotions') {
      return {
        select: mocks.promotionSelect,
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  mocks.adminEq.mockImplementation(() => {
    return { maybeSingle: mocks.adminMaybeSingle };
  });
  mocks.promotionSelect.mockImplementation(() => ({ order: mocks.promotionOrder }));
}

describe('GET /api/promotions admin security boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    vi.clearAllMocks();
    configureDatabase();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.permissionMaybeSingle.mockResolvedValue({ data: { is_enabled: true }, error: null });
    mocks.promotionOrder.mockResolvedValue({ data: [promotionRow], error: null });
  });

  it('rejects an anonymous caller before querying promotions and disables caching', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('promotions');
    expect(mocks.anonymousFrom).not.toHaveBeenCalled();
  });

  it('rejects an authenticated non-admin before querying promotions', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'synthetic-customer-id', email: 'customer@example.invalid' } }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: null, error: null });

    const customerId = 'synthetic-customer-id';
    const response = await GET(request('http://localhost/api/promotions', {
      'x-user-id': adminUser.id,
      'x-role': 'ADMIN',
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.adminEq).toHaveBeenCalledWith('id', customerId);
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('promotions');
    expect(mocks.anonymousFrom).not.toHaveBeenCalled();
  });

  it('checks the authenticated user against the active-admin table, then returns only the admin DTO', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: adminRecord, error: null });

    const response = await GET(request());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.adminEq).toHaveBeenCalledWith('id', adminUser.id);
    expect(mocks.promotionSelect).toHaveBeenCalledWith(
      'id, title, body, target_type, game_id, package_id, image_url, cta_text, cta_href, starts_at, ends_at, is_active, sort_order, placement, target_game_id',
    );
    expect(mocks.promotionOrder).toHaveBeenCalledWith('sort_order');
    expect(json.data).toEqual([{
      id: promotionRow.id,
      title: promotionRow.title,
      body: promotionRow.body,
      target_type: promotionRow.target_type,
      game_id: promotionRow.game_id,
      package_id: promotionRow.package_id,
      image_url: promotionRow.image_url,
      cta_text: promotionRow.cta_text,
      cta_href: promotionRow.cta_href,
      starts_at: promotionRow.starts_at,
      ends_at: promotionRow.ends_at,
      is_active: promotionRow.is_active,
      sort_order: promotionRow.sort_order,
      placement: promotionRow.placement,
      target_game_id: promotionRow.target_game_id,
    }]);
    expect(JSON.stringify(json)).not.toContain('internal_note');
    expect(JSON.stringify(json)).not.toContain('created_at');
    expect(mocks.anonymousFrom).not.toHaveBeenCalled();
  });

  it('rejects unsupported query parameters without reading promotions', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: adminRecord, error: null });

    const response = await GET(request('http://localhost/api/promotions?include=private'));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Unsupported query parameters.');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('promotions');
  });

  it('masks database errors and never falls back to the anonymous client', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: adminRecord, error: null });
    mocks.promotionOrder.mockResolvedValue({
      data: null,
      error: { message: 'synthetic SQL detail and privileged configuration' },
    });

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toContain('Promotions are temporarily unavailable.');
    expect(body).not.toContain('synthetic SQL detail');
    expect(body).not.toContain('privileged configuration');
    expect(mocks.anonymousFrom).not.toHaveBeenCalled();
  });

  it('masks thrown query failures', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: adminRecord, error: null });
    mocks.promotionOrder.mockRejectedValue(new Error('synthetic internal exception'));

    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).not.toContain('synthetic internal exception');
    expect(mocks.anonymousFrom).not.toHaveBeenCalled();
  });
});

describe('POST /api/promotions validation boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    vi.clearAllMocks();
    configureDatabase();
    mocks.getUser.mockResolvedValue({ data: { user: adminUser }, error: null });
    mocks.adminMaybeSingle.mockResolvedValue({ data: adminRecord, error: null });
    mocks.permissionMaybeSingle.mockResolvedValue({ data: { is_enabled: true }, error: null });
  });

  it('rejects an unknown target instead of silently treating it as a global promotion', async () => {
    const response = await POST(postRequest({ title: 'Synthetic', body: 'Fixture', target_type: 'SOMETHING' }));
    expect(response.status).toBe(400);
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('promotions');
  });

  it('rejects javascript CTA URLs before the database write', async () => {
    const response = await POST(postRequest({ title: 'Synthetic', body: 'Fixture', cta_href: 'javascript:alert(1)' }));
    expect(response.status).toBe(400);
    expect(mocks.adminFrom).not.toHaveBeenCalledWith('promotions');
  });
});

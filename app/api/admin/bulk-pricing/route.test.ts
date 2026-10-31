import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireCatalogAdmin: vi.fn(), from: vi.fn(), rpc: vi.fn(), limit: vi.fn(), select: vi.fn() }))

vi.mock('@/lib/catalogAdminGuard', () => ({ requireCatalogAdmin: mocks.requireCatalogAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: mocks.from, rpc: mocks.rpc } }))

import { GET, POST } from './route'

const actorId = '11111111-1111-4111-8111-111111111111'
const packageId = '22222222-2222-4222-8222-222222222222'
const authorized = { ok: true, session: { userId: actorId, role: 'ADMIN' }, client: {} }

function post(body: unknown) {
  return new NextRequest('http://localhost/api/admin/bulk-pricing', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCatalogAdmin.mockResolvedValue(authorized)
  mocks.limit.mockResolvedValue({
    data: [{ id: packageId, name: 'Synthetic package', sku: 'FIXTURE', price_cents: 10000, is_active: true, catalog_status: 'PUBLISHED', games: { name: 'Synthetic game' }, supplier_cost_usd: 123 }],
    error: null,
  })
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  mocks.select.mockImplementation(() => builder)
  builder.select = mocks.select
  builder.order = chain
  builder.limit = mocks.limit
  mocks.from.mockReturnValue(builder)
  mocks.rpc.mockResolvedValue({ data: { updated_count: 1, updated_ids: [packageId] }, error: null })
})

describe('/api/admin/bulk-pricing', () => {
  it('returns only storefront-safe package pricing fields', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/bulk-pricing'))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.packages).toEqual([expect.objectContaining({ id: packageId, price_cents: 10000 })])
    expect(JSON.stringify(json)).not.toContain('supplier_cost_usd')
    expect(mocks.select).toHaveBeenCalledWith('id,name,sku,price_cents,is_active,catalog_status,games(name)')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects duplicate package ids before invoking the transactional database operation', async () => {
    const response = await POST(post({ packageIds: [packageId, packageId], action: 'set_price', value: 12000 }))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('attributes authorized pricing changes to the verified session and reports republish requirement', async () => {
    const response = await POST(post({ packageIds: [packageId], action: 'set_price', value: 12000 }))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('admin_bulk_reprice_packages', {
      p_actor_id: actorId, p_package_ids: [packageId], p_action: 'set_price', p_value: 12000,
    })
    expect(json).toMatchObject({ updated: 1, packageIds: [packageId], requiresRepublish: true })
  })

  it('rejects callers without pricing permission before database access', async () => {
    mocks.requireCatalogAdmin.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
    const response = await POST(post({ packageIds: [packageId], action: 'set_price', value: 12000 }))
    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), from: vi.fn(), select: vi.fn(), upsert: vi.fn(), single: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: mocks.from } }))

import { GET, PATCH } from './route'

const actorId = '11111111-1111-4111-8111-111111111111'
const superAdmin = { ok: true, session: { userId: actorId, email: 'owner@example.invalid', name: 'Owner', role: 'SUPER_ADMIN' }, client: {} }
const admin = { ok: true, session: { userId: '22222222-2222-4222-8222-222222222222', email: 'admin@example.invalid', name: 'Admin', role: 'ADMIN' }, client: {} }

function request(body?: unknown) {
  return new NextRequest('http://localhost/api/admin/roles', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue(superAdmin)
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = mocks.select.mockImplementation(chain)
  builder.order = vi.fn().mockResolvedValue({ data: [], error: null })
  builder.upsert = mocks.upsert.mockImplementation(chain)
  builder.single = mocks.single
  mocks.from.mockReturnValue(builder)
  mocks.single.mockResolvedValue({ data: { role: 'STAFF', permission_key: 'tasks.manage', is_enabled: false }, error: null })
})

describe('admin role permission API', () => {
  it('keeps persisted permission reads super-admin only', async () => {
    mocks.requireAdmin.mockResolvedValue(admin)
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('persists a supported permission change with the authenticated super-admin actor', async () => {
    const response = await PATCH(request({ role: 'STAFF', permission: 'tasks.manage', enabled: false }))
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      role: 'STAFF', permission_key: 'tasks.manage', is_enabled: false, updated_by: actorId,
    }), { onConflict: 'role,permission_key' })
    expect(json.grant).toMatchObject({ role: 'STAFF', permission_key: 'tasks.manage', is_enabled: false })
  })

  it('rejects unsupported keys before the write', async () => {
    const response = await PATCH(request({ role: 'SUPER_ADMIN', permission: 'system.root', enabled: true }))
    expect(response.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})

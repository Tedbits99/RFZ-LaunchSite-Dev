import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdminPermission: vi.fn(), from: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: (...args: unknown[]) => mocks.from(...args) } }))

import { GET, PATCH } from './route'

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/checkout-policy', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const superAdmin = { ok: true, session: { userId: 'trusted-session-id', email: 'owner@example.invalid', name: 'Owner', role: 'SUPER_ADMIN' }, client: { rpc: mocks.rpc } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminPermission.mockResolvedValue(superAdmin)
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  const query: Record<string, unknown> = {}
  const chain = () => query
  query.select = chain
  query.eq = chain
  query.maybeSingle = () => Promise.resolve({ data: { allow_guest_checkout: true, updated_at: '2026-10-31T00:00:00.000Z' }, error: null })
  mocks.from.mockReturnValue(query)
})

describe('admin checkout policy endpoint', () => {
  it('reads current persisted state without returning credentials', async () => {
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: true, updatedAt: '2026-10-31T00:00:00.000Z' })
  })

  it('uses the authenticated session RPC and never accepts a browser actor identity', async () => {
    const response = await PATCH(request('PATCH', { enabled: false }))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_allow_guest_checkout', { p_enabled: false })
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('browser-user')
  })

  it('rejects malformed or extra identity fields and does not call the database', async () => {
    const response = await PATCH(request('PATCH', { enabled: false, actorId: 'browser-user' }))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('denies a non-super-admin before reaching the database RPC', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ...superAdmin, session: { ...superAdmin.session, role: 'ADMIN' } })
    const response = await PATCH(request('PATCH', { enabled: false }))
    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

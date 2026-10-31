import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdminPermission: vi.fn(), from: vi.fn(), listUsers: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    auth: { admin: { listUsers: (...args: unknown[]) => mocks.listUsers(...args) } },
  },
}))

import { GET, PATCH, POST } from './route'

const actorId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const confirmedUser = { id: targetId, email: 'staff@example.invalid', email_confirmed_at: '2026-10-01T00:00:00Z' }
const admin = { ok: true, session: { userId: actorId, email: 'owner@example.invalid', name: 'Owner', role: 'SUPER_ADMIN' }, client: {} }

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/staff', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminPermission.mockResolvedValue(admin)
  mocks.listUsers.mockResolvedValue({ data: { users: [confirmedUser] }, error: null })
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.order = chain
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
  builder.insert = vi.fn(() => builder)
  builder.single = () => Promise.resolve({ data: { id: targetId, email: confirmedUser.email, name: 'Staff', role: 'STAFF', is_active: true }, error: null })
  mocks.from.mockReturnValue(builder)
})

describe('admin staff endpoint', () => {
  it('denies callers without staff.manage before reading membership data', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, response: new Response('denied', { status: 403 }) })
    const response = await GET(request('GET'))
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not let an ordinary admin grant an elevated role', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ...admin, session: { ...admin.session, role: 'ADMIN' } })
    const response = await POST(request('POST', { email: confirmedUser.email, name: 'Staff', role: 'ADMIN' }))
    expect(response.status).toBe(403)
    expect(mocks.listUsers).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('creates membership only for a confirmed existing Auth identity and attributes it to the session actor', async () => {
    const response = await POST(request('POST', { email: confirmedUser.email, name: 'Staff', role: 'STAFF' }))
    expect(response.status).toBe(201)
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 })
    const builder = mocks.from.mock.results[1].value as { insert: ReturnType<typeof vi.fn> }
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: targetId,
      email: confirmedUser.email,
      role: 'STAFF',
      updated_by: actorId,
    }))
  })

  it('rejects self-modification before database access', async () => {
    const response = await PATCH(request('PATCH', { id: actorId, isActive: false }))
    expect(response.status).toBe(409)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

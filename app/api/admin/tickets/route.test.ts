import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdminPermission: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: (...args: unknown[]) => mocks.from(...args) } }))

import { GET, PATCH } from './route'

const ticketId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const session = { ok: true, session: { userId: actorId, email: 'staff@example.invalid', name: 'Staff', role: 'STAFF' }, client: {} }

function request(method: string, body?: unknown, url = 'http://localhost/api/admin/tickets') {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminPermission.mockResolvedValue(session)
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.order = chain
  builder.limit = chain
  builder.eq = chain
  builder.update = vi.fn(() => builder)
  builder.maybeSingle = () => Promise.resolve({ data: { id: ticketId, status: 'IN_PROGRESS', priority: 'NORMAL', last_admin_actor_id: actorId }, error: null })
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
  mocks.from.mockReturnValue(builder)
})

describe('admin support ticket workflow', () => {
  it('requires the ticket permission before reading protected customer data', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, response: new Response('denied', { status: 403 }) })
    const response = await GET(request('GET'))
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects unsupported status values and actor fields', async () => {
    const invalidStatus = await PATCH(request('PATCH', { id: ticketId, status: 'APPROVED' }))
    const forgedActor = await PATCH(request('PATCH', { id: ticketId, priority: 'HIGH', last_admin_actor_id: 'browser' }))
    expect(invalidStatus.status).toBe(400)
    expect(forgedActor.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('attributes status updates to the authenticated admin and performs no customer messaging', async () => {
    const response = await PATCH(request('PATCH', { id: ticketId, status: 'IN_PROGRESS' }))
    expect(response.status).toBe(200)
    const builder = mocks.from.mock.results[0].value as { update: ReturnType<typeof vi.fn> }
    expect(builder.update).toHaveBeenCalledWith({ status: 'IN_PROGRESS', last_admin_actor_id: actorId })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('validates requested ticket identifiers before querying', async () => {
    const response = await GET(request('GET', undefined, 'http://localhost/api/admin/tickets?id=not-a-uuid'))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

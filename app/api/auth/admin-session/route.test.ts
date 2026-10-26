import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolveAdminSession: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ resolveAdminSession: mocks.resolveAdminSession }))

import { GET } from './route'

describe('GET /api/auth/admin-session', () => {
  it('returns only an authorization result for an active admin', async () => {
    mocks.resolveAdminSession.mockResolvedValue({
      ok: true,
      session: { userId: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
    })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ authorized: true })
  })

  it('denies a signed-in customer without leaking session details', async () => {
    mocks.resolveAdminSession.mockResolvedValue({ ok: false, reason: 'forbidden' })

    const response = await GET()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      authorized: false,
      error: 'This account is not authorized for the admin console.',
    })
  })

  it('returns a retryable response when authentication infrastructure is unavailable', async () => {
    mocks.resolveAdminSession.mockResolvedValue({ ok: false, reason: 'unavailable' })

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      authorized: false,
      error: 'Admin authentication is temporarily unavailable.',
    })
  })
})

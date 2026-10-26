import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  createAdminServerClient: vi.fn(),
}))

vi.mock('@/lib/authSessionClients', () => ({
  createAdminServerClient: mocks.createAdminServerClient,
}))

import { GET, POST } from './route'

const origin = 'https://example.test'

function request(body: unknown, method = 'POST', includeOrigin = true) {
  return new NextRequest(`${origin}/api/auth/admin-login`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(includeOrigin ? { origin } : {}),
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

function nativeFormRequest(email: string, password: string) {
  return new NextRequest(`${origin}/api/auth/admin-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ email, password }),
  })
}

function installClient() {
  mocks.createAdminServerClient.mockReturnValue({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
      getUser: mocks.getUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
      })),
    })),
  })
}

const validInput = { email: ' Owner@Example.COM ', password: 'owner-password' }

describe('POST /api/auth/admin-login', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = origin
    installClient()
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'owner@example.com' } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { email: 'owner@example.com', name: 'Owner', role: 'SUPER_ADMIN', is_active: true }, error: null })
  })

  it('authenticates an active UUID- and email-matched admin through the server client', async () => {
    const response = await POST(request(validInput))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: 'Signed in.' })
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: validInput.password })
    expect(mocks.maybeSingle).toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('supports a native pre-hydration form without putting credentials in the URL', async () => {
    const response = await POST(nativeFormRequest('owner@example.com', validInput.password))
    const location = response.headers.get('location') || ''

    expect(response.status).toBe(303)
    expect(location).toBe(`${origin}/admin`)
    expect(location).not.toContain('owner@example.com')
    expect(location).not.toContain(validInput.password)
  })

  it('rejects invalid Auth credentials generically and clears any local session', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } })

    const response = await POST(request(validInput))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid email or password.' })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('rejects a customer or stale admin mapping after Auth succeeds', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'customer-1', email: 'customer@example.com' } }, error: null })
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await POST(request(validInput))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'This account is not authorized for the admin console.' })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('rejects an email mismatch even when the UUID and active role match', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1', email: 'new-owner@example.com' } }, error: null })

    const response = await POST(request(validInput))

    expect(response.status).toBe(403)
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('rejects untrusted origins and unsupported methods', async () => {
    expect((await POST(request(validInput, 'POST', false))).status).toBe(403)
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect((await GET()).status).toBe(405)
  })

  it('never returns passwords, roles, tokens, or provider details', async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ error: { message: 'provider detail' } })
    const response = await POST(request({ ...validInput, password: 'secret-password', role: 'SUPER_ADMIN' }))
    const body = await response.text()

    expect(body).not.toContain('secret-password')
    expect(body).not.toContain('provider detail')
    expect(body).not.toContain('access_token')
    expect(body).not.toContain('SUPER_ADMIN')
  })
})

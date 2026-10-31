import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdminPermission: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/supabaseAdmin', () => ({ adminSupabase: { from: mocks.from } }))

import { GET } from './route'

const authorized = { ok: true, session: { userId: '11111111-1111-4111-8111-111111111111', email: 'admin@example.invalid', name: 'Admin', role: 'ADMIN' }, client: {} }
const request = () => new NextRequest('http://localhost/api/admin/system-diagnostics')

function configureDatabase(fail = false) {
  mocks.from.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = chain
    builder.eq = chain
    if (table === 'payment_config') {
      builder.order = chain
      builder.limit = () => Promise.resolve(fail
        ? { data: null, error: { message: 'synthetic secret-bearing SQL diagnostics' } }
        : { data: [{ method_key: 'manual_fixture', is_enabled: true, is_test_mode: true }], error: null })
    } else {
      builder.maybeSingle = () => Promise.resolve(fail
        ? { data: null, error: { message: 'synthetic database connection details' } }
        : table === 'app_settings'
          ? { data: { id: 1, reference_usd_php_rate: 56, payment_fee_reserve_bps: 250, payment_fee_fixed_cents: 100, supplier_fulfillment_release_enabled: false }, error: null }
          : { data: { allow_guest_checkout: true }, error: null })
    }
    return builder
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminPermission.mockResolvedValue(authorized)
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-never-return-this'
  process.env.RESEND_API_KEY = ''
  configureDatabase()
})

describe('admin system diagnostics', () => {
  it('reports runtime-backed checks separately from unknown hosted state and exposes secret presence only', async () => {
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.application.status).toBe('PASS')
    expect(body.database.status).toBe('PASS')
    expect(body.paymentMethods.methods).toEqual([{ key: 'manual_fixture', enabled: true, testMode: true }])
    expect(body.externalChecks).toMatchObject({ productionEnvironmentIdentity: 'UNKNOWN', cloudflareWorkerAndAccess: 'UNKNOWN', providerConnectivity: 'NOT_TESTED' })
    expect(body.releaseGates).toMatchObject({ supplierFulfillment: 'LOCKED', rfCoinsFunding: 'LOCKED', rfCoinsSpending: 'LOCKED' })
    expect(body.secretPresence).toContainEqual({ name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', configured: true })
    expect(JSON.stringify(body)).not.toContain('synthetic-never-return-this')
  })

  it('reports database failures without echoing internal error details', async () => {
    configureDatabase(true)
    const response = await GET(request())
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('"database":{"status":"FAIL"')
    expect(body).not.toContain('synthetic database connection details')
    expect(body).not.toContain('secret-bearing SQL')
  })

  it('denies diagnostic reads to a role without system.view', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

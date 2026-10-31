import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireAdminPermission: vi.fn(), maybeSingle: vi.fn() }))

vi.mock('@/lib/adminGuard', () => ({ requireAdminPermission: mocks.requireAdminPermission }))
vi.mock('@/lib/supabaseAdmin', () => ({
  adminSupabase: {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })) })) })),
  },
}))

import { requireVoucherAdmin } from './voucherAdminGuard'

const request = new NextRequest('http://localhost/api/admin/vouchers/campaigns')
const authorized = {
  ok: true,
  session: { userId: '11111111-1111-4111-8111-111111111111', email: 'admin@example.invalid', name: 'Admin', role: 'ADMIN' },
  client: {},
}

describe('voucher campaign authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminPermission.mockResolvedValue(authorized)
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'ADMIN', is_active: true }, error: null })
  })

  it('requires the persisted marketing permission before reading membership or calling campaign RPCs', async () => {
    mocks.requireAdminPermission.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
    const result = await requireVoucherAdmin(request)
    expect(result.ok).toBe(false)
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith(request, 'marketing.manage')
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })

  it('does not let STAFF manage financially significant voucher campaigns even if marketing is granted', async () => {
    mocks.requireAdminPermission.mockResolvedValue({
      ...authorized,
      session: { ...authorized.session, role: 'STAFF' },
    })
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'STAFF', is_active: true }, error: null })
    const result = await requireVoucherAdmin(request)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('allows active Admin and Super Admin identities only after permission validation', async () => {
    const result = await requireVoucherAdmin(request)
    expect(result.ok).toBe(true)
    expect(mocks.requireAdminPermission).toHaveBeenCalledWith(request, 'marketing.manage')
  })
})

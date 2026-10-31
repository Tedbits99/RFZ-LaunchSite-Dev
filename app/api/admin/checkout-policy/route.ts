import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'

export const dynamic = 'force-dynamic'

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'settings.manage')
  if (!auth.ok) return auth.response
  const db = adminSupabase || auth.client
  const { data, error } = await db.from('checkout_policy')
    .select('allow_guest_checkout,updated_at')
    .eq('setting_key', 'allow_guest_checkout')
    .maybeSingle()
  if (error) return fail('Checkout policy could not be read.', 503)
  if (!data) return fail('Checkout policy is not initialized.', 503)
  return NextResponse.json({ enabled: data.allow_guest_checkout, updatedAt: data.updated_at }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'settings.manage')
  if (!auth.ok) return auth.response
  if (auth.session.role !== 'SUPER_ADMIN') return fail('Only a super admin can change guest checkout policy.', 403)
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
    return fail('A single boolean enabled value is required.', 400)
  }

  // Use the cookie-authenticated client so the existing database function
  // verifies auth.uid() and confirmed-email status; never pass a browser id.
  const { data, error } = await auth.client.rpc('admin_set_allow_guest_checkout', { p_enabled: body.enabled })
  if (error) {
    if (/FORBIDDEN/i.test(error.message)) return fail('The authenticated account is not eligible to change checkout policy.', 403)
    return fail('Checkout policy could not be saved.', 503)
  }
  return NextResponse.json({ enabled: data === true, updatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
}

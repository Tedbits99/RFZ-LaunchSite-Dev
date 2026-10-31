import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'

const STAFF_COLUMNS = 'id,email,name,role,is_active,claimed_at'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_ROLES = new Set(['STAFF', 'ADMIN', 'SUPER_ADMIN'])

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'staff.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return jsonError('Staff management is unavailable in this environment.', 503)

  const { data, error } = await adminSupabase
    .from('admins')
    .select(STAFF_COLUMNS)
    .order('claimed_at', { ascending: true })
  if (error) return jsonError('Staff could not be loaded.', 503)
  return NextResponse.json({ staff: data || [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'staff.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return jsonError('Staff management is unavailable in this environment.', 503)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return jsonError('A valid JSON object is required.', 400)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const role = typeof body.role === 'string' ? body.role : 'STAFF'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return jsonError('Enter a valid email address.', 400)
  if (name.length < 1 || name.length > 100) return jsonError('Name must be 1 to 100 characters.', 400)
  if (!ALLOWED_ROLES.has(role)) return jsonError('Unsupported staff role.', 400)
  if (auth.session.role !== 'SUPER_ADMIN' && role !== 'STAFF') return jsonError('Only a super admin can grant admin-level roles.', 403)

  const user = await findConfirmedAuthUser(email)
  if (user.error) return jsonError('The existing account could not be verified.', 503)
  if (!user.user) return jsonError('No confirmed account exists for this email. The user must register first; this action does not create credentials or send email.', 404)
  if (user.user.id === auth.session.userId) return jsonError('You cannot change your own admin access.', 409)

  const { data: existing, error: lookupError } = await adminSupabase
    .from('admins')
    .select('id')
    .eq('id', user.user.id)
    .maybeSingle()
  if (lookupError) return jsonError('Staff membership could not be checked.', 503)
  if (existing) return jsonError('This account already has admin access.', 409)

  const { data, error } = await adminSupabase
    .from('admins')
    .insert({
      id: user.user.id,
      email,
      name,
      role,
      is_active: true,
      updated_by: auth.session.userId,
    })
    .select(STAFF_COLUMNS)
    .single()
  if (error) return mapMembershipError(error.code)
  return NextResponse.json({ admin: data }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'staff.manage')
  if (!auth.ok) return auth.response
  if (!adminSupabase) return jsonError('Staff management is unavailable in this environment.', 503)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return jsonError('A valid JSON object is required.', 400)
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID_PATTERN.test(id)) return jsonError('A valid staff id is required.', 400)
  if (id === auth.session.userId) return jsonError('You cannot change your own admin access.', 409)
  const hasRole = Object.hasOwn(body, 'role')
  const hasActive = Object.hasOwn(body, 'isActive')
  if (!hasRole && !hasActive) return jsonError('No supported staff changes were supplied.', 400)
  if (hasRole && (typeof body.role !== 'string' || !ALLOWED_ROLES.has(body.role))) return jsonError('Unsupported staff role.', 400)
  if (hasActive && typeof body.isActive !== 'boolean') return jsonError('isActive must be a boolean.', 400)

  const { data: current, error: lookupError } = await adminSupabase
    .from('admins')
    .select('id,role,is_active')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return jsonError('Staff membership could not be checked.', 503)
  if (!current) return jsonError('Staff member not found.', 404)
  if (auth.session.role !== 'SUPER_ADMIN') {
    const nextRole = hasRole ? body.role : current.role
    if (current.role !== 'STAFF' || nextRole !== 'STAFF') return jsonError('Only a super admin can modify admin-level accounts.', 403)
  }

  const updates: Record<string, unknown> = { updated_by: auth.session.userId }
  if (hasRole) updates.role = body.role
  if (hasActive) updates.is_active = body.isActive
  const { data, error } = await adminSupabase
    .from('admins')
    .update(updates)
    .eq('id', id)
    .select(STAFF_COLUMNS)
    .single()
  if (error) return mapMembershipError(error.code)
  return NextResponse.json({ admin: data }, { headers: { 'Cache-Control': 'no-store' } })
}

async function findConfirmedAuthUser(email: string) {
  const maxPages = 5
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await adminSupabase!.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { user: null, error }
    const match = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email)
    if (match) return { user: match.email_confirmed_at ? match : null, error: null }
    if (data.users.length < 1000) break
    if (page === maxPages) return { user: null, error: new Error('Auth directory search limit reached.') }
  }
  return { user: null, error: null }
}

function mapMembershipError(code?: string) {
  if (code === '23505') return jsonError('An admin membership already exists for this account.', 409)
  if (code === '23514') return jsonError('That change would remove the last active super admin.', 409)
  if (code === '42501') return jsonError('The requested staff change is not authorized.', 403)
  return jsonError('The staff change could not be saved.', 500)
}

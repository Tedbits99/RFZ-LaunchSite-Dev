import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminGuard'
import { ADMIN_PERMISSION_CATALOG, isAdminPermissionKey } from '@/lib/adminPermissions'

function forbidden() {
  return NextResponse.json({ error: 'Only a super admin can manage role permissions.' }, { status: 403 })
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  if (auth.session.role !== 'SUPER_ADMIN') return forbidden()
  if (!adminSupabase) return NextResponse.json({ error: 'Role permissions are unavailable in this environment.' }, { status: 503 })

  const { data, error } = await adminSupabase
    .from('admin_role_permissions')
    .select('role,permission_key,is_enabled,updated_at')
    .order('role')
  if (error) return NextResponse.json({ error: 'Role permissions could not be loaded.' }, { status: 503 })
  return NextResponse.json({
    catalog: ADMIN_PERMISSION_CATALOG,
    grants: data || [],
    protectedRoles: ['SUPER_ADMIN'],
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  if (auth.session.role !== 'SUPER_ADMIN') return forbidden()
  if (!adminSupabase) return NextResponse.json({ error: 'Role permissions are unavailable in this environment.' }, { status: 503 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !['STAFF', 'ADMIN'].includes(String(body.role)) || !isAdminPermissionKey(body.permission) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Role, permission, and enabled state are required.' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('admin_role_permissions')
    .upsert({
      role: body.role,
      permission_key: body.permission,
      is_enabled: body.enabled,
      updated_by: auth.session.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'role,permission_key' })
    .select('role,permission_key,is_enabled,updated_at')
    .single()
  if (error) return NextResponse.json({ error: 'Role permission could not be saved.' }, { status: 500 })
  return NextResponse.json({ grant: data }, { headers: { 'Cache-Control': 'no-store' } })
}

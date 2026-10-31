import { NextRequest, NextResponse } from 'next/server'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminGuard'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  if (auth.session.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Only a super admin can read the admin audit log.' }, { status: 403 })
  }
  if (!adminSupabase) {
    return NextResponse.json({ error: 'The audit log is unavailable in this environment.' }, { status: 503 })
  }

  const pageValue = Number(new URL(req.url).searchParams.get('page') || '0')
  const page = Number.isSafeInteger(pageValue) && pageValue >= 0 && pageValue <= 1000 ? pageValue : 0
  const pageSize = 50
  const { data, error } = await adminSupabase
    .from('admin_audit_events')
    .select('id,actor_id,actor_email,actor_role,action,target_type,target_id,metadata,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) {
    return NextResponse.json({ error: 'The audit log could not be loaded.' }, { status: 503 })
  }
  return NextResponse.json({ events: data || [], page, pageSize, hasMore: (data || []).length === pageSize }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

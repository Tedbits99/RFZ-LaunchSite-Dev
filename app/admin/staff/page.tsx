import { AdminPage } from '@/components/admin/AdminPage'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { getAdminPermissionSet, getAdminSession } from '@/lib/adminGuard'
import { StaffManager, type AdminStaffRecord } from './StaffManager'

export const dynamic = 'force-dynamic'

export default async function AdminStaffPage() {
  const session = await getAdminSession()
  if (!session) return null
  const permissions = await getAdminPermissionSet(session.role)
  if (!permissions?.includes('*') && !permissions?.includes('staff.manage')) {
    return <AdminPage title="Staff"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Your role cannot manage staff access.</p></AdminPage>
  }
  if (!adminSupabase) {
    return <AdminPage title="Staff"><p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-200">Staff data is unavailable in this environment.</p></AdminPage>
  }

  const { data, error } = await adminSupabase
    .from('admins')
    .select('id,email,name,role,is_active,claimed_at')
    .order('claimed_at', { ascending: true })

  if (error) {
    return <AdminPage title="Staff"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Staff data could not be loaded. Retry later.</p></AdminPage>
  }

  return <AdminPage title="Staff"><StaffManager staff={(data || []) as AdminStaffRecord[]} actorId={session.userId} actorRole={session.role} /></AdminPage>
}

import { AdminPage } from '@/components/admin/AdminPage'
import { getAdminSession } from '@/lib/adminGuard'
import { RolesManager } from './RolesManager'

export const dynamic = 'force-dynamic'

export default async function AdminRolesPage() {
  const session = await getAdminSession()
  if (!session) return null
  if (session.role !== 'SUPER_ADMIN') {
    return <AdminPage title="Roles"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Only a super admin can manage role permissions.</p></AdminPage>
  }
  return <AdminPage title="Roles"><RolesManager /></AdminPage>
}

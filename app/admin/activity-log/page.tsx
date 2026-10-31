import { AdminPage } from '@/components/admin/AdminPage'
import { getAdminSession } from '@/lib/adminGuard'
import AuditLogClient from './AuditLogClient'

export const dynamic = 'force-dynamic'

export default async function AdminActivityLogPage() {
  const session = await getAdminSession()
  if (!session) return null
  if (session.role !== 'SUPER_ADMIN') {
    return <AdminPage title="Activity Log"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Only a super admin can read the admin audit log.</p></AdminPage>
  }
  return <AdminPage title="Activity Log"><AuditLogClient /></AdminPage>
}

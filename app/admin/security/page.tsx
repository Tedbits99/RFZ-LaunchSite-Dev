import { AdminPage } from '@/components/admin/AdminPage'
import AdminDiagnosticsClient from '../system-health/AdminDiagnosticsClient'

export const dynamic = 'force-dynamic'

export default function AdminSecurityPage() {
  return <AdminPage title="Security"><AdminDiagnosticsClient mode="security" /></AdminPage>
}

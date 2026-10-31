import { AdminPage } from '@/components/admin/AdminPage'
import AdminDiagnosticsClient from './AdminDiagnosticsClient'

export const dynamic = 'force-dynamic'

export default function AdminSystemHealthPage() {
  return <AdminPage title="System Health"><AdminDiagnosticsClient mode="health" /></AdminPage>
}

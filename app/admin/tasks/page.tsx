import { AdminPage } from '@/components/admin/AdminPage'
import AdminTasksClient from './AdminTasksClient'

export const dynamic = 'force-dynamic'

export default function AdminTasksPage() {
  return <AdminPage title="Tasks"><AdminTasksClient /></AdminPage>
}

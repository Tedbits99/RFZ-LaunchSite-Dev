import { AdminPage } from '@/components/admin/AdminPage'
import TicketManager from './TicketManager'

export const dynamic = 'force-dynamic'

export default function AdminTicketsPage() {
  return <AdminPage title="Support tickets"><TicketManager /></AdminPage>
}

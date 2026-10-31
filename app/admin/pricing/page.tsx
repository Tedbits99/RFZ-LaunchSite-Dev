import { AdminPage } from '@/components/admin/AdminPage'
import AdminPricingManager from './PricingManager'

export const dynamic = 'force-dynamic'

export default function AdminPricingPage() {
  return <AdminPage title="Catalog pricing"><AdminPricingManager /></AdminPage>
}

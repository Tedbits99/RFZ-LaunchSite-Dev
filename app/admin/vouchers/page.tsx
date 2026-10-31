import { AdminPage } from '@/components/admin/AdminPage';
import { PageHeader } from '@/components/admin/ui';
import CampaignsClient from './CampaignsClient';

export const dynamic = 'force-dynamic';

export default function AdminVouchersPage() {
  return (
    <AdminPage title="Vouchers">
      <PageHeader
        title="Promotions & vouchers"
        subtitle="Create, schedule, target, and measure discount campaigns"
      />
      <CampaignsClient />
    </AdminPage>
  );
}

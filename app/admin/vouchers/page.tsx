import { AdminPage } from '@/components/admin/AdminPage';
import { PageHeader } from '@/components/admin/ui';
import CampaignsClient from './CampaignsClient';
import { getAdminSession, getAdminPermissionSet } from '@/lib/adminGuard';
import { AdminPermissionDenied } from '@/components/admin/AdminPermissionDenied';

export const dynamic = 'force-dynamic';

export default async function AdminVouchersPage() {
  const session = await getAdminSession();
  if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.role)) return <AdminPermissionDenied feature="voucher campaigns" />;
  const grants = await getAdminPermissionSet(session.role);
  if (!grants?.includes('*') && !grants?.includes('marketing.manage')) return <AdminPermissionDenied feature="voucher campaigns" />;
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

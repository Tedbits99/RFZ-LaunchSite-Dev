import { AdminPage } from '@/components/admin/AdminPage';
import { PageHeader } from '@/components/admin/ui';
import { Tag } from 'lucide-react';
import VouchersClient from './VouchersClient';

export const dynamic = 'force-dynamic';

export default function AdminVouchersPage() {
  return (
    <AdminPage title="Vouchers">
      <PageHeader
        title="Vouchers"
        subtitle="Create, edit, and track discount codes"
      />
      <VouchersClient />
    </AdminPage>
  );
}

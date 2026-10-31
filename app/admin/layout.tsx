import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getAdminPermissionSet, getAdminSession } from '@/lib/adminGuard';
import AdminShell from './AdminShell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();
  if (!session) notFound();
  const permissions = await getAdminPermissionSet(session.role);

  return <AdminShell role={session.role} permissions={permissions || []}>{children}</AdminShell>;
}

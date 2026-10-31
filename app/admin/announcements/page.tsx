import AnnouncementsClient from './AnnouncementsClient';
import { getAdminPermissionSet, getAdminSession } from '@/lib/adminGuard';

export const dynamic = 'force-dynamic';

export default async function AdminAnnouncementsPage() {
  const session = await getAdminSession();
  if (!session) return null;
  const permissions = await getAdminPermissionSet(session.role);
  if (!permissions?.includes('*') && !permissions?.includes('marketing.manage')) {
    return <main className="mx-auto max-w-[1180px] px-5 py-8"><p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">Your role cannot manage announcements.</p></main>;
  }
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Global Announcement</h1>
        <p className="text-xs text-slate-500">Configure the storefront popup announcement</p>
      </div>
      <AnnouncementsClient />
    </div>
  );
}

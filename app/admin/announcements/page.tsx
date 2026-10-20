import AnnouncementsClient from './AnnouncementsClient';

export const dynamic = 'force-dynamic';

export default function AdminAnnouncementsPage() {
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

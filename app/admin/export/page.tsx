import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPageSession } from '@/lib/adminGuard';
import { Download } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminExportPage() {
  await requireAdminPageSession();
  let count = 0;
  let dbReady = false;
  if (adminSupabase) { dbReady = true; const { count: c } = await adminSupabase.from('orders').select('*', { count: 'exact', head: true }); count = c || 0; }
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Export</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Export Data</h1>
        <p className="text-xs text-slate-500">Download orders and catalog data as CSV</p>
        <div className="mt-6 space-y-3">
          <a href="/api/export/orders" className="flex items-center gap-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5 transition hover:border-cyan-400"><Download className="text-cyan-300" size={18} /><div className="flex-1"><h3 className="font-display font-semibold">Orders CSV</h3><p className="text-xs text-slate-500">{dbReady ? `${count} orders available` : 'Database not configured'}</p></div></a>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <div className="flex items-center gap-4">
              <Download className="text-emerald-300" size={18} />
              <div className="flex-1">
                <h3 className="font-display font-semibold">Orders (Detailed) CSV</h3>
                <p className="text-xs text-slate-500">Reference, customer, game, package, amount, statuses, payment & supplier references, timestamps</p>
              </div>
            </div>
            <form className="mt-4 space-y-3" action="/api/export/orders" method="GET">
              <input type="hidden" name="detailed" value="1" />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input name="q" placeholder="Search reference or email" className="flex-1 rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-xs text-slate-300 outline-none" />
                <select name="status" defaultValue="ALL" className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-xs text-slate-300">
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">PENDING</option>
                  <option value="WAITING_PAYMENT">WAITING_PAYMENT</option>
                  <option value="PAYMENT_VERIFIED">PAYMENT_VERIFIED</option>
                  <option value="PAID">PAID</option>
                  <option value="PROCESSING">PROCESSING</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="FULFILLMENT_FAILED">FULFILLMENT_FAILED</option>
                  <option value="FAILED">FAILED</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="CANCELLED">CANCELLED</option>
                  <option value="REFUND_PENDING">REFUND_PENDING</option>
                  <option value="REFUNDED">REFUNDED</option>
                </select>
                <input type="date" name="date" className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-xs text-slate-300" />
              </div>
              <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-xs font-semibold transition hover:brightness-110 sm:w-auto">
                <Download size={14} /> Download Detailed CSV
              </button>
            </form>
          </div>
          <a href="/api/export/games" className="flex items-center gap-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5 transition hover:border-cyan-400"><Download className="text-violet-300" size={18} /><div className="flex-1"><h3 className="font-display font-semibold">Games & Packages CSV</h3><p className="text-xs text-slate-500">Full catalog export</p></div></a>
        </div>
      </div>
    </main>
  );
}

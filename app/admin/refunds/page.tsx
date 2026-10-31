import { adminSupabase } from '@/lib/supabaseAdmin';
import { RotateCcw } from 'lucide-react';
import { hasAdminPagePermission } from '@/lib/adminGuard';
import { AdminPermissionDenied } from '@/components/admin/AdminPermissionDenied';

export const dynamic = 'force-dynamic';

export default async function AdminRefundsPage() {
  if (!await hasAdminPagePermission(['payments.view', 'payments.refund'])) return <AdminPermissionDenied feature="refund records" />;
  let refunds: Array<{ id: string; reference: string; status: string; total_cents: number; email: string; created_at: string }> = [];
  let dbReady = false;
  if (adminSupabase) { dbReady = true; const { data } = await adminSupabase.from('orders').select('id, reference, status, total_cents, email, created_at').in('status', ['REFUND_REQUESTED','REFUNDED']).order('created_at', { ascending: false }); refunds = (data || []) as typeof refunds; }
  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Refunds</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Refunds</h1>
        {!dbReady ? <p className="mt-8 text-sm text-slate-500">Database not configured.</p> :
          <div className="mt-6 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Customer</th><th className="p-4 font-medium">Status</th><th className="p-4 text-right font-medium">Amount</th><th className="p-4 font-medium">Date</th></tr></thead>
              <tbody>{refunds.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-600"><RotateCcw className="mx-auto mb-2 text-slate-700" size={24} />No refund requests.</td></tr>}{refunds.map((r) => <tr key={r.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300">{r.reference}</td><td className="p-4 text-slate-300">{r.email}</td><td className="p-4 font-medium text-orange-300">{r.status}</td><td className="p-4 text-right font-medium">{fmtP(r.total_cents)}</td><td className="p-4 text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td></tr>)}</tbody>
            </table>
          </div>}
      </div>
    </main>
  );
}

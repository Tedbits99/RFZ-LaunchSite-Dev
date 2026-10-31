import { adminSupabase } from '@/lib/supabaseAdmin';
import { Users } from 'lucide-react';
import { hasAdminPagePermission } from '@/lib/adminGuard';
import { AdminPermissionDenied } from '@/components/admin/AdminPermissionDenied';

export const dynamic = 'force-dynamic';

export default async function AdminCustomersPage() {
  if (!await hasAdminPagePermission('customers.view')) return <AdminPermissionDenied feature="customer records" />;
  let customers: Array<{ email: string; order_count: number; total_spent: number; last_order: string }> = [];
  let dbReady = false;
  if (adminSupabase) {
    dbReady = true;
    const { data } = await adminSupabase.from('orders').select('email, total_cents, status, created_at');
    const rows = (data || []) as Array<{ email: string; total_cents: number; status: string; created_at: string }>;
    const map = new Map<string, { order_count: number; total_spent: number; last_order: string }>();
    for (const r of rows) {
      const e = r.email.toLowerCase();
      const existing = map.get(e) || { order_count: 0, total_spent: 0, last_order: r.created_at };
      existing.order_count++;
      if (r.status === 'PAID' || r.status === 'COMPLETED' || r.status === 'PROCESSING') existing.total_spent += r.total_cents;
      if (r.created_at > existing.last_order) existing.last_order = r.created_at;
      map.set(e, existing);
    }
    customers = Array.from(map.entries()).map(([email, v]) => ({ email, ...v })).sort((a, b) => b.total_spent - a.total_spent);
  }
  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  return (
    <main className="rfz-admin-route min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Customers</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Customers</h1>
        {!dbReady ? <p className="mt-8 text-sm text-slate-500">Database not configured.</p> :
          <div className="mt-6 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Email</th><th className="p-4 font-medium">Orders</th><th className="p-4 font-medium">Total Spent</th><th className="p-4 font-medium">Last Order</th></tr></thead>
              <tbody>{customers.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-600"><Users className="mx-auto mb-2 text-slate-700" size={24} />No customers yet.</td></tr>}{customers.map((c) => (
                <tr key={c.email} className="border-b border-[#0f1b31]"><td className="p-4 text-slate-300">{c.email}</td><td className="p-4 text-slate-400">{c.order_count}</td><td className="p-4 font-medium text-emerald-300">{fmtP(c.total_spent)}</td><td className="p-4 text-slate-500">{new Date(c.last_order).toLocaleDateString()}</td></tr>
              ))}</tbody>
            </table>
          </div>}
      </div>
    </main>
  );
}

import { Package, UserRound, Wallet } from 'lucide-react';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import SiteFooter from '@/components/SiteFooter';

export const dynamic = 'force-dynamic';

type Order = { id: string; reference: string; status: string; total_cents: number; created_at: string; games?: { name: string } | null };

export default async function Account() {
  let email: string | null = null;
  let orders: Order[] = [];

  try {
    const authClient = createSupabaseServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : null;

    if (email) {
      const db = adminSupabase || authClient;
      const { data } = await db
        .from('orders')
        .select('id, reference, status, total_cents, created_at, games(name)')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(20);
      orders = (data as unknown as Order[]) || [];
    }
  } catch {
    // Missing local configuration or an unavailable session is treated as a
    // guest account, which must not receive private order data.
  }

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  const totalSpent = orders.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED').reduce((s, o) => s + o.total_cents, 0);

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto max-w-[1180px] px-5 py-4"><a href="/" className="text-xs text-cyan-300">← Back to store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <h1 className="font-display text-3xl font-bold">My Account</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><UserRound className="text-cyan-300" size={20} /><p className="mt-3 text-xs text-slate-400">Profile</p><p className="font-display text-lg font-bold">{email || 'Guest'}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Package className="text-violet-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Orders</p><p className="font-display text-lg font-bold">{orders.length}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Wallet className="text-emerald-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Spent</p><p className="font-display text-lg font-bold">{fmtP(totalSpent)}</p></div>
        </div>
        <h2 className="font-display mt-10 mb-4 text-xl font-bold">Order History</h2>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          {!email ? <p className="p-6 text-sm text-slate-500">Sign in to view private order history, or <a href="/track-order" className="text-cyan-300">track a guest order</a> using its reference and email.</p> : orders.length === 0 ? <p className="p-6 text-sm text-slate-500">No orders yet. <a href="/" className="text-cyan-300">Browse games</a> to get started.</p> :
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Game</th><th className="p-4 font-medium">Status</th><th className="p-4 text-right font-medium">Total</th></tr></thead>
              <tbody>{orders.map((o) => <tr key={o.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300"><a href={`/account/orders/${o.id}`}>{o.reference}</a></td><td className="p-4 text-slate-300">{o.games?.name || '—'}</td><td className="p-4 text-slate-400">{o.status}</td><td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td></tr>)}</tbody>
            </table>}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

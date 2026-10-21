import { Package, UserRound, Wallet } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { getOrderPresentation } from '@/lib/orderPresentation';

export const dynamic = 'force-dynamic';

type Order = { id: string; reference: string; status: string; total_cents: number; created_at: string; games?: { name: string } | null };

export default async function Account() {
  const session = await getActiveCustomerSession();
  if (!session) redirect('/login');

  const { data } = await session.client
    .from('orders')
    .select('id, reference, status, total_cents, created_at, games(name)')
    .eq('customer_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  const orders = (data as unknown as Order[]) || [];
  const email = typeof session.user.email === 'string' ? session.user.email.trim().toLowerCase() : null;

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  const totalSpent = orders.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED').reduce((s, o) => s + o.total_cents, 0);

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto max-w-[1180px] px-5 py-4"><a href="/" className="text-xs text-cyan-300">← Back to store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs uppercase tracking-[.18em] text-cyan-300">Customer hub</p><h1 className="font-display mt-2 text-3xl font-bold">My Account</h1></div><nav aria-label="Account navigation" className="flex flex-wrap gap-2 text-xs"><a href="/account/orders" className="rounded-lg border border-[#233653] px-3 py-2 text-slate-300 hover:border-cyan-300 hover:text-cyan-200">All orders</a><a href="/track-order" className="rounded-lg border border-[#233653] px-3 py-2 text-slate-300 hover:border-cyan-300 hover:text-cyan-200">Guest tracking</a><a href="/account/profile" className="rounded-lg border border-[#233653] px-3 py-2 text-slate-300 hover:border-cyan-300 hover:text-cyan-200">Profile</a></nav></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><UserRound className="text-cyan-300" size={20} /><p className="mt-3 text-xs text-slate-400">Profile</p><p className="font-display text-lg font-bold">{email || 'Guest'}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Package className="text-violet-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Orders</p><p className="font-display text-lg font-bold">{orders.length}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Wallet className="text-emerald-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Spent</p><p className="font-display text-lg font-bold">{fmtP(totalSpent)}</p></div>
        </div>
        <div className="mt-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">RF Coins Wallet</p>
          <p className="mt-2 text-sm text-slate-300">Balance, coin packages and transaction history are in your <a href="/account/wallet" className="text-cyan-300">RF Coins wallet</a>.</p>
        </div>
        {orders.length > 0 && <section className="mt-8 rounded-xl border border-cyan-400/15 bg-[#0b1225] p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-lg font-bold">Current orders</h2><p className="mt-1 text-xs text-slate-500">Quick access to your latest status and recovery options.</p></div><a href="/account/orders" className="text-xs text-cyan-300">View history →</a></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{orders.slice(0, 2).map((o) => { const presentation = getOrderPresentation(o.status); return <a key={o.id} href={`/account/orders/${o.id}`} className="rounded-lg border border-[#20304b] bg-[#080f20] p-4 transition hover:border-cyan-300"><div className="flex items-start justify-between gap-3"><span className="font-mono text-xs text-cyan-300">{o.reference}</span><span className={`rounded-full border px-2 py-1 text-[10px] ${presentation.tone}`}>{presentation.label}</span></div><p className="mt-3 text-sm font-medium">{o.games?.name || 'Order'}</p><p className="mt-1 text-xs text-slate-500">{presentation.message}</p></a>; })}</div></section>}
        <h2 className="font-display mt-10 mb-4 text-xl font-bold">Order History</h2>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          {orders.length === 0 ? <p className="p-6 text-sm text-slate-500">No orders yet. <a href="/" className="text-cyan-300">Browse games</a> to get started.</p> :
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Game</th><th className="p-4 font-medium">Status</th><th className="p-4 text-right font-medium">Total</th></tr></thead>
              <tbody>{orders.map((o) => <tr key={o.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300"><a href={`/account/orders/${o.id}`}>{o.reference}</a></td><td className="p-4 text-slate-300">{o.games?.name || '—'}</td><td className="p-4"><span className={`rounded-full border px-2 py-1 text-[10px] ${getOrderPresentation(o.status).tone}`}>{getOrderPresentation(o.status).label}</span></td><td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td></tr>)}</tbody>
            </table>}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

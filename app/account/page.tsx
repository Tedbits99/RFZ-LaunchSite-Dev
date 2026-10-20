import { Package, UserRound, Wallet } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import AccountHeader from '@/components/account/AccountHeader';

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
      <AccountHeader />
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <h1 className="font-display text-3xl font-bold">My Account</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><UserRound className="text-cyan-300" size={20} /><p className="mt-3 text-xs text-slate-400">Profile</p><p className="font-display text-lg font-bold">{email || 'Guest'}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Package className="text-violet-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Orders</p><p className="font-display text-lg font-bold">{orders.length}</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><Wallet className="text-emerald-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total Spent</p><p className="font-display text-lg font-bold">{fmtP(totalSpent)}</p></div>
        </div>
        <div className="mt-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">RF Coins Wallet</p>
          <p className="mt-2 text-sm text-slate-300">Balance, coin packages and transaction history are in your <a href="/account/wallet" className="text-cyan-300">RF Coins wallet</a>.</p>
        </div>
        <h2 className="font-display mt-10 mb-4 text-xl font-bold">Order History</h2>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          {orders.length === 0 ? <p className="p-6 text-sm text-slate-500">No orders yet. <a href="/" className="text-cyan-300">Browse games</a> to get started.</p> :
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Game</th><th className="p-4 font-medium">Status</th><th className="p-4 text-right font-medium">Total</th></tr></thead>
              <tbody>{orders.map((o) => <tr key={o.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300"><a href={`/account/orders/${o.id}`}>{o.reference}</a></td><td className="p-4 text-slate-300">{o.games?.name || '—'}</td><td className="p-4 text-slate-400">{o.status}</td><td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td></tr>)}</tbody>
            </table>}
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

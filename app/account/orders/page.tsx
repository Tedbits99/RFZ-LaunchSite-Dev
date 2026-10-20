import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import AccountHeader from '@/components/account/AccountHeader';

export const dynamic = 'force-dynamic';

type Order = {
  id: string;
  reference: string;
  status: string;
  total_cents: number;
  created_at: string;
  games?: { name: string } | null;
  packages?: { name: string } | null;
};

const statusColor: Record<string, string> = {
  WAITING_PAYMENT: 'text-amber-300',
  PAID: 'text-emerald-300',
  PROCESSING: 'text-blue-300',
  COMPLETED: 'text-emerald-400',
  DELIVERED: 'text-cyan-300',
  CANCELLED: 'text-rose-300',
  REFUND_PENDING: 'text-orange-300',
  REFUNDED: 'text-slate-400',
};

export default async function AccountOrders() {
  // Account history is based only on immutable Auth UUID ownership. Existing
  // guest orders remain unlinked and use the separate verified recovery flow.
  const session = await getActiveCustomerSession();
  if (!session) redirect('/login');

  const { data } = await session.client
    .from('orders')
    .select('id, reference, status, total_cents, created_at, games(name), packages(name)')
    .eq('customer_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  const orders = (data || []) as unknown as Order[];

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <AccountHeader backHref="/account" backLabel="Account" />
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/account">Account</Link>
          <ChevronRight size={12} />
          <span className="text-slate-300">Orders</span>
        </nav>
        <h1 className="font-display mt-4 text-2xl font-bold">My Orders</h1>
        <p className="mt-2 text-sm text-slate-400">View your order history and track status.</p>

        {orders.length === 0 ? (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-center text-sm text-slate-500">
            <Package className="mx-auto mb-2 text-slate-700" size={24} />
            No orders found for this email. <Link href="/" className="text-cyan-300">Browse games</Link> to place your first order.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-[#1b2a45]">
                  <th className="p-4 font-medium">Reference</th>
                  <th className="p-4 font-medium">Game</th>
                  <th className="p-4 font-medium">Package</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 text-right font-medium">Total</th>
                  <th className="p-4 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                    <td className="p-4 font-mono text-cyan-300"><Link href={`/account/orders/${o.id}`}>{o.reference}</Link></td>
                    <td className="p-4 text-slate-400">{o.games?.name || '—'}</td>
                    <td className="p-4 text-slate-400">{o.packages?.name || '—'}</td>
                    <td className="p-4"><span className={`font-medium ${statusColor[o.status] || 'text-slate-400'}`}>{o.status}</span></td>
                    <td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td>
                    <td className="p-4 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}

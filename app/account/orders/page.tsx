import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import SiteFooter from '@/components/SiteFooter';

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

export default async function AccountOrders({ searchParams }: { searchParams: { email?: string } }) {
  let orders: Order[] = [];
  let hasEmail = false;

  // The account page is email-based (no auth yet). If an email param is provided,
  // load that customer's orders. Otherwise show the search prompt.
  if (searchParams.email) {
    const client = adminSupabase || supabase;
    if (client) {
      hasEmail = true;
      const { data } = await client
        .from('orders')
        .select('id, reference, status, total_cents, created_at, games(name), packages(name)')
        .ilike('email', searchParams.email)
        .order('created_at', { ascending: false })
        .limit(20);
      orders = (data || []) as unknown as Order[];
    }
  }

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90">
        <div className="mx-auto max-w-[1180px] px-5 py-4">
          <a href="/account" className="text-xs text-cyan-300">← Account</a>
        </div>
      </header>
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <Link href="/account">Account</Link>
          <ChevronRight size={12} />
          <span className="text-slate-300">Orders</span>
        </nav>
        <h1 className="font-display mt-4 text-2xl font-bold">My Orders</h1>
        <p className="mt-2 text-sm text-slate-400">View your order history and track status.</p>

        {!hasEmail ? (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-500">
            <p>Enter your email to see your orders, or <Link href="/track-order" className="text-cyan-300">track a specific order</Link>.</p>
            <form className="mt-4 flex gap-2" action="/account/orders" method="GET">
              <input name="email" type="email" placeholder="your@email.com" className="flex-1 rounded-lg border border-[#22314d] bg-[#0a1124] px-4 py-2.5 text-sm outline-none focus:border-cyan-400" />
              <button type="submit" className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold">Show Orders</button>
            </form>
          </div>
        ) : orders.length === 0 ? (
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

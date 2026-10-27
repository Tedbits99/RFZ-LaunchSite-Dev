import Link from 'next/link';
import { ChevronRight, Package } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { getOrderPresentation } from '@/lib/orderPresentation';
import ThemeSelector from '@/components/ThemeSelector';
import { getCustomerLoginUrl } from '@/lib/authRedirect';

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

export default async function AccountOrders({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  // Account history is based only on immutable Auth UUID ownership. Existing
  // guest orders remain unlinked and use the separate verified recovery flow.
  const session = await getActiveCustomerSession();
  if (!session) redirect(getCustomerLoginUrl('/account/orders'));

  const requestedPage = Number((await searchParams).page || '1');
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = 20;
  const { data, count, error } = await session.client
    .from('orders')
    .select('id, reference, status, total_cents, created_at, games(name), packages(name)', { count: 'exact' })
    .eq('customer_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  const orders = (data || []) as unknown as Order[];
  const pageCount = Math.max(1, Math.ceil((count || 0) / pageSize));

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-4">
          <a href="/account" className="text-xs text-cyan-300">← Account</a><ThemeSelector />
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

        {error ? (
          <div className="mt-6 rounded-xl border border-rose-400/30 bg-rose-400/5 p-6 text-sm text-rose-200" role="alert">Your order history could not be loaded. Refresh the page to try again.</div>
        ) : orders.length === 0 ? (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-center text-sm text-slate-500">
            <Package className="mx-auto mb-2 text-slate-700" size={24} />
            No orders found for this email. <Link href="/" className="text-cyan-300">Browse games</Link> to place your first order.
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <div className="divide-y divide-[#0f1b31] md:hidden">{orders.map((o) => { const presentation = getOrderPresentation(o.status); return <Link key={o.id} href={`/account/orders/${o.id}`} className="block p-4 transition hover:bg-[#0f1a33]"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-sm text-cyan-300">{o.reference}</p><p className="mt-1 text-xs text-slate-400">{o.games?.name || 'Game'} · {o.packages?.name || 'Package'}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${presentation.tone}`}>{presentation.label}</span></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">{new Date(o.created_at).toLocaleDateString()}</span><span className="font-semibold text-slate-200">{fmtP(o.total_cents)}</span></div><p className="mt-2 text-[11px] text-slate-500">{presentation.message}</p></Link>; })}</div>
          <div className="hidden overflow-x-auto md:block">
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
                    <td className="p-4"><span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${getOrderPresentation(o.status).tone}`}>{getOrderPresentation(o.status).label}</span></td>
                    <td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td>
                    <td className="p-4 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
        {!error && pageCount > 1 ? <nav aria-label="Order history pages" className="mt-4 flex items-center justify-between"><span className="text-xs text-slate-500">Page {page} of {pageCount}</span><div className="flex gap-2"><Link aria-disabled={page <= 1} className={`rounded-lg border px-3 py-2 text-sm ${page <= 1 ? 'pointer-events-none border-[#1b2a45] text-slate-600' : 'border-[#233653] text-cyan-200'}`} href={`/account/orders?page=${page - 1}`}>Previous</Link><Link aria-disabled={page >= pageCount} className={`rounded-lg border px-3 py-2 text-sm ${page >= pageCount ? 'pointer-events-none border-[#1b2a45] text-slate-600' : 'border-[#233653] text-cyan-200'}`} href={`/account/orders?page=${page + 1}`}>Next</Link></div></nav> : null}
      </div>
      <SiteFooter />
    </main>
  );
}

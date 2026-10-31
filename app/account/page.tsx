import { Package, Wallet } from 'lucide-react';
import AccountFooter from '@/components/account/AccountFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import { getOrderPresentation } from '@/lib/orderPresentation';
import { getCustomerLoginUrl } from '@/lib/authRedirect';
import RetryServerDataButton from '@/components/account/RetryServerDataButton';
import { summarizeAccountOrders } from '@/lib/accountOrderSummary';
import { logPostgrestQueryFailure } from '@/lib/postgrestDiagnostics';

export const dynamic = 'force-dynamic';

type Order = { id: string; reference: string; status: string; payment_status: string; total_cents: number; created_at: string; games?: { name: string } | null };

export default async function Account() {
  const session = await getActiveCustomerSession();
  if (!session) redirect(getCustomerLoginUrl('/account'));

  const { data, error: ordersError } = await session.client
    .from('orders')
    .select('id, reference, status, payment_status, total_cents, created_at, games(name)')
    .eq('customer_user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (ordersError) logPostgrestQueryFailure('customer_account_recent_orders', ordersError);
  const orders = (data as unknown as Order[]) || [];
  // The recent-order list is intentionally bounded for rendering. Summary
  // numbers come from a separate owner-scoped query so older orders cannot be
  // silently omitted from the account totals.
  const { count: totalOrderCount, error: countError } = await session.client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('customer_user_id', session.user.id);
  if (countError) logPostgrestQueryFailure('customer_account_order_count', countError);
  // Keep list and count states separate: an exact owner-scoped count can remain
  // trustworthy even when the related recent-order query is temporarily down.
  const summary = summarizeAccountOrders({
    recentOrders: orders,
    exactOrderCount: totalOrderCount,
    listError: Boolean(ordersError),
    countError: Boolean(countError),
  });
  const { data: profileData, error: profileError } = await session.client.from('customer_profiles').select('display_name').eq('user_id', session.user.id).maybeSingle();
  if (profileError) logPostgrestQueryFailure('customer_account_profile', profileError);
  const email = typeof session.user.email === 'string' ? session.user.email.trim().toLowerCase() : null;
  const displayName = (profileData as { display_name?: string } | null)?.display_name?.trim() || email?.split('@')[0] || 'Player';

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  return (
    <main className="rfz-account-page min-h-screen bg-[#030718] text-slate-100">
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs uppercase tracking-[.18em] text-cyan-300">RunFazone Command Center</p><h1 className="font-display mt-2 text-3xl font-bold">Welcome back, {displayName}</h1><p className="mt-2 break-all text-sm text-slate-400">{email} <span className="ml-2 inline-flex items-center gap-1 text-emerald-300"><span aria-hidden="true">✓</span> Verified</span></p></div><a href="/#games" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 text-sm font-semibold">Browse games</a></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5"><Package className="text-violet-300" size={20} /><p className="mt-3 text-xs text-slate-400">Total orders</p><p className="font-display text-2xl font-bold">{summary.totalOrders ?? '—'}</p><a href="/account/orders" className="mt-2 inline-flex min-h-10 items-center text-xs text-cyan-300">View order history <span aria-hidden="true" className="ml-1">→</span></a></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5"><Wallet className="text-emerald-300" size={20} /><p className="mt-3 text-xs text-slate-400">Verified payments · latest 20 orders</p><p className="font-display text-2xl font-bold">{summary.recentVerifiedPaymentCents === null ? '—' : fmtP(summary.recentVerifiedPaymentCents)}</p><p className="mt-2 text-xs text-slate-500">Not a lifetime spending total.</p></div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5"><p className="text-xs text-slate-400">Latest order</p>{ordersError ? <p className="mt-3 text-sm text-rose-200">Status unavailable</p> : orders[0] ? <><p className="font-display mt-2 text-lg font-semibold">{getOrderPresentation(orders[0].status).label}</p><p className="mt-1 truncate font-mono text-xs text-slate-500">{orders[0].reference}</p><a href={`/account/orders/${orders[0].id}`} className="mt-2 inline-flex min-h-10 items-center text-xs text-cyan-300">Order details <span aria-hidden="true" className="ml-1">→</span></a></> : <><p className="mt-3 text-sm text-slate-300">No orders yet</p><a href="/#games" className="mt-2 inline-flex min-h-10 items-center text-xs text-cyan-300">Browse games <span aria-hidden="true" className="ml-1">→</span></a></>}</div>
        </div>
        <div className="mt-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">RF Coins Wallet</p>
          <p className="mt-2 text-sm text-slate-300">Balance, coin packages and transaction history are in your <a href="/account/wallet" className="text-cyan-300">RF Coins wallet</a>.</p>
        </div>
        {ordersError || countError ? <section className="mt-8 rounded-xl border border-rose-400/25 bg-rose-400/5 p-5 text-sm text-rose-200" role="alert">{ordersError ? <p>Your recent orders could not be loaded.</p> : null}{countError ? <p>Your exact order count is temporarily unavailable.</p> : null}<RetryServerDataButton /><a href="/account/orders" className="ml-3 inline-flex min-h-10 items-center text-xs text-cyan-200 underline underline-offset-4">Open order history</a></section> : orders.length > 0 && <section className="mt-8 rounded-xl border border-cyan-400/15 bg-[#0b1225] p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-lg font-bold">Current orders</h2><p className="mt-1 text-xs text-slate-500">Quick access to your latest status and recovery options.</p></div><a href="/account/orders" className="text-xs text-cyan-300">View history →</a></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{orders.slice(0, 2).map((o) => { const presentation = getOrderPresentation(o.status); return <a key={o.id} href={`/account/orders/${o.id}`} className="rounded-lg border border-[#20304b] bg-[#080f20] p-4 transition hover:border-cyan-300"><div className="flex items-start justify-between gap-3"><span className="break-all font-mono text-xs text-cyan-300">{o.reference}</span><span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${presentation.tone}`}>{presentation.label}</span></div><p className="mt-3 text-sm font-medium">{o.games?.name || 'Order'}</p><p className="mt-1 text-xs text-slate-500">{presentation.message}</p></a>; })}</div></section>}
        <h2 className="font-display mt-10 mb-4 text-xl font-bold">Order History</h2>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          {ordersError ? <div className="p-6 text-sm text-rose-200" role="alert"><p>Order history is temporarily unavailable. Your account data has not been changed.</p><RetryServerDataButton /><a href="/account/orders" className="ml-3 inline-flex min-h-10 items-center text-xs text-cyan-200 underline underline-offset-4">Open full order history</a></div> : orders.length === 0 ? <p className="p-6 text-sm text-slate-500">No orders yet. <a href="/" className="text-cyan-300">Browse games</a> to get started.</p> :
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Game</th><th className="p-4 font-medium">Status</th><th className="p-4 text-right font-medium">Total</th></tr></thead>
              <tbody>{orders.map((o) => <tr key={o.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300"><a href={`/account/orders/${o.id}`}>{o.reference}</a></td><td className="p-4 text-slate-300">{o.games?.name || '—'}</td><td className="p-4"><span className={`rounded-full border px-2 py-1 text-[10px] ${getOrderPresentation(o.status).tone}`}>{getOrderPresentation(o.status).label}</span></td><td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td></tr>)}</tbody>
            </table>}
        </div>
      </div>
      <AccountFooter />
    </main>
  );
}

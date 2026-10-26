import { createSupabaseServerClient } from '@/lib/supabaseServer';
import GamesVisibilityPanel from './GamesVisibilityPanel';
import FazerCardsWebhookFeed from './suppliers/FazerCardsWebhookFeed';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, Clock, Gamepad2, Package, ShoppingCart, Users, XCircle } from 'lucide-react';
import { MetricCard, PageHeader, StatusBadge, Surface } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

type OrderRow = { id: string; reference: string; email: string; status: string; total_cents: number; created_at: string; games?: { name: string } | null; packages?: { name: string } | null };
type GameRow = { id: string; name: string; slug: string; is_active: boolean; is_featured: boolean };
type PackageRow = { id: string; name: string; price_cents: number; games?: { name: string } | null };

async function getMetrics(): Promise<{
  orders: OrderRow[];
  games: GameRow[];
  packages: PackageRow[];
  customerEmails: string[];
  error: string | null;
}> {
  const empty = { orders: [], games: [], packages: [], customerEmails: [], error: null as string | null };
  let db: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    // This page is nested under app/admin/layout.tsx which already performs
    // the authoritative getAdminSession() check and denies unauthorized
    // requests before rendering children. Avoid a second Supabase getUser()
    // network call and JWT verification in the same SSR request: it wastes
    // scarce Cloudflare Worker CPU and adds no independent authorization.
    // The following Supabase reads remain RLS-backed by the user's session.
    db = await createSupabaseServerClient();
  } catch {
    return { ...empty, error: 'Database not configured' };
  }

  try {
    const [orders, games, packages, customers] = await Promise.all([
      db.from('orders').select('id, reference, email, status, total_cents, created_at, games(name), packages(name)').order('created_at', { ascending: false }).limit(100),
      db.rpc('admin_get_all_games'),
      db.from('packages').select('id, name, price_cents, games(name)').order('created_at'),
      db.from('orders').select('email'),
    ]);

    return {
      orders: (orders.data as unknown as OrderRow[] | null) ?? [],
      games: (games.data as unknown as GameRow[] | null) ?? [],
      packages: (packages.data as unknown as PackageRow[] | null) ?? [],
      customerEmails: (customers.data ?? []).map((r: { email: string }) => r.email),
      error: null,
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : 'Failed to load metrics' };
  }
}

const fmtP = (cents: number) => `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
export default async function AdminDashboard() {
  const data = await getMetrics();
  const { orders, games, packages, error } = data;
  const uniqueCustomers = new Set(data.customerEmails);
  const revenue = orders.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED' || o.status === 'PROCESSING').reduce((s, o) => s + o.total_cents, 0);
  const pending = orders.filter((o) => o.status === 'PENDING' || o.status === 'PAYMENT_PENDING').length;
  const waiting = orders.filter((o) => o.status === 'WAITING_PAYMENT').length;
  const paid = orders.filter((o) => o.status === 'PAID').length;
  const completed = orders.filter((o) => o.status === 'COMPLETED').length;
  const cancelled = orders.filter((o) => o.status === 'CANCELLED').length;
  const failed = orders.filter((o) => o.status === 'FAILED').length;

  const cards = [
    { label: 'Total Orders', value: orders.length, icon: ShoppingCart, tone: 'blue' as const },
    { label: 'Revenue', value: fmtP(revenue), icon: Banknote, tone: 'emerald' as const },
    { label: 'Pending', value: pending, icon: Clock, tone: 'amber' as const, detail: 'Needs attention' },
    { label: 'Customers', value: uniqueCustomers.size, icon: Users, tone: 'violet' as const },
    { label: 'Paid', value: paid, icon: CheckCircle2, tone: 'cyan' as const },
    { label: 'Completed', value: completed, icon: ArrowUpRight, tone: 'emerald' as const },
    { label: 'Cancelled', value: cancelled, icon: ArrowDownRight, tone: 'rose' as const },
    { label: 'Failed', value: failed, icon: XCircle, tone: 'rose' as const },
    { label: 'Games', value: games.length, icon: Gamepad2, tone: 'blue' as const },
  ];

  return (
    <main className="rfz-admin-dashboard mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader
        title="Overview"
        subtitle="A live snapshot of orders, revenue, fulfillment, and catalog health."
        action={<Link href="/admin/orders" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-cyan-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">View orders</Link>}
      />

      {error && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Could not load live data: {error}. Showing empty state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map((c) => <MetricCard key={c.label} {...c} />)}</div>

      <Surface className="mt-6 p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-display text-sm font-semibold">Order health</h2><p className="mt-1 text-xs text-slate-500">A quick view of the current fulfillment pipeline.</p></div><Link href="/admin/orders" className="text-xs font-medium text-cyan-300 hover:text-cyan-200">Review orders <span aria-hidden="true">→</span></Link></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">{[['Pending', pending, 'PENDING'], ['Paid', paid, 'PAID'], ['Processing', orders.filter((o) => o.status === 'PROCESSING').length, 'PROCESSING'], ['Completed', completed, 'COMPLETED'], ['Cancelled', cancelled, 'CANCELLED'], ['Failed', failed, 'FAILED']].map(([label, count, status]) => <div key={label as string} className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-3"><StatusBadge status={status as string} /><p className="font-display mt-3 text-xl font-bold">{count as number}</p><p className="mt-1 text-[10px] text-slate-500">{label as string}</p></div>)}</div>
      </Surface>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Surface className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div><h2 className="font-display text-sm font-semibold">Operations queue</h2><p className="mt-1 text-xs text-slate-500">Prioritized shortcuts for the work most likely to need attention.</p></div>
            <span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">Live data</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link href="/admin/orders?status=WAITING_PAYMENT" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 transition hover:border-amber-300/50"><p className="text-xs font-semibold text-amber-200">Payment review</p><p className="mt-2 font-display text-2xl font-bold text-white">{waiting}</p><p className="mt-1 text-[11px] text-slate-500">Orders waiting for payment</p></Link>
            <Link href="/admin/orders?status=PROCESSING" className="rounded-xl border border-blue-400/20 bg-blue-400/5 p-4 transition hover:border-blue-300/50"><p className="text-xs font-semibold text-blue-200">Fulfillment queue</p><p className="mt-2 font-display text-2xl font-bold text-white">{orders.filter((o) => o.status === 'PROCESSING').length}</p><p className="mt-1 text-[11px] text-slate-500">Orders with active fulfillment</p></Link>
            <Link href="/admin/orders?status=FAILED" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 transition hover:border-rose-300/50"><p className="text-xs font-semibold text-rose-200">Failed orders</p><p className="mt-2 font-display text-2xl font-bold text-white">{failed}</p><p className="mt-1 text-[11px] text-slate-500">Needs investigation or recovery</p></Link>
          </div>
        </Surface>
        <Surface className="p-5">
          <h2 className="font-display text-sm font-semibold">Quick actions</h2>
          <div className="mt-4 grid gap-2 text-xs">
            <Link href="/admin/games" className="rounded-lg border border-[#1b2a45] px-3 py-3 text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200">Manage game visibility <span className="float-right">→</span></Link>
            <Link href="/admin/pricing" className="rounded-lg border border-[#1b2a45] px-3 py-3 text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200">Review package pricing <span className="float-right">→</span></Link>
            <Link href="/admin/system-health" className="rounded-lg border border-[#1b2a45] px-3 py-3 text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200">Open system health <span className="float-right">→</span></Link>
          </div>
        </Surface>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Surface className="p-4 sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="font-display text-sm font-semibold text-white">Recent orders</h2><p className="mt-1 text-xs text-slate-500">The latest records returned by the admin query.</p></div>
            <Link href="/admin/orders" className="text-xs font-medium text-cyan-300 hover:text-cyan-200">Open all <span aria-hidden="true">→</span></Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="pb-3 font-medium">Reference</th><th className="pb-3 font-medium">Customer</th><th className="pb-3 font-medium">Game</th><th className="pb-3 font-medium">Status</th><th className="pb-3 text-right font-medium">Total</th></tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-slate-500">No orders yet. Orders from the storefront will appear here.</td></tr>}
                {orders.slice(0, 12).map((o) => (
                  <tr key={o.id} className="border-b border-[#0f1b31] last:border-0">
                    <td className="py-3 font-mono text-cyan-300">{o.reference}</td>
                    <td className="py-3 text-slate-300">{o.email}</td>
                    <td className="py-3 text-slate-400">{o.games?.name || '—'}</td>
                    <td className="py-3"><StatusBadge status={o.status} /></td>
                    <td className="py-3 text-right font-medium">{fmtP(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>

        <div className="space-y-4">
          <Surface className="p-5">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-sm font-semibold">Catalog</h2><Link href="/admin/games" className="text-xs text-cyan-300 hover:text-cyan-200">Manage</Link></div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><Gamepad2 size={14} className="text-cyan-300" /> Games</span><span className="font-display font-bold text-slate-200">{games.length}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><Package size={14} className="text-violet-300" /> Packages</span><span className="font-display font-bold text-slate-200">{packages.length}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><XCircle size={14} className="text-rose-300" /> Cancelled</span><span className="font-display font-bold text-slate-200">{cancelled}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><XCircle size={14} className="text-rose-400" /> Failed</span><span className="font-display font-bold text-slate-200">{failed}</span></div>
            </div>
          </Surface>
          <GamesVisibilityPanel initialGames={games.map((g) => ({ id: g.id, name: g.name, slug: g.slug, is_active: g.is_active, is_featured: g.is_featured }))} />
        </div>
      </div>
      <div className="mt-6"><FazerCardsWebhookFeed compact /></div>
    </main>
  );
}

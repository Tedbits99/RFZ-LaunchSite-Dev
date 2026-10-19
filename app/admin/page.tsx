import { createSupabaseServerClient } from '@/lib/supabaseServer';
import GamesVisibilityPanel from './GamesVisibilityPanel';
import { ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, Clock, Gamepad2, Package, ShoppingCart, Users, XCircle } from 'lucide-react';

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
  let db: ReturnType<typeof createSupabaseServerClient>;
  try {
    db = createSupabaseServerClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return { ...empty, error: 'Not authenticated' };
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
const statusColor: Record<string, string> = { PENDING: 'text-amber-300', PAID: 'text-emerald-300', PROCESSING: 'text-blue-300', COMPLETED: 'text-emerald-400', CANCELLED: 'text-rose-300', FAILED: 'text-rose-400', REFUND_REQUESTED: 'text-orange-300', REFUNDED: 'text-slate-400', PAYMENT_PENDING: 'text-amber-200' };

export default async function AdminDashboard() {
  const data = await getMetrics();
  const { orders, games, packages, error } = data;
  const uniqueCustomers = new Set(data.customerEmails);
  const revenue = orders.filter((o) => o.status === 'PAID' || o.status === 'COMPLETED' || o.status === 'PROCESSING').reduce((s, o) => s + o.total_cents, 0);
  const pending = orders.filter((o) => o.status === 'PENDING' || o.status === 'PAYMENT_PENDING').length;
  const paid = orders.filter((o) => o.status === 'PAID').length;
  const completed = orders.filter((o) => o.status === 'COMPLETED').length;
  const cancelled = orders.filter((o) => o.status === 'CANCELLED' || o.status === 'FAILED').length;

  const cards = [
    { label: 'Total Orders', value: orders.length, icon: ShoppingCart, accent: 'from-blue-500/20 to-blue-600/5', iconColor: 'text-blue-300' },
    { label: 'Revenue', value: fmtP(revenue), icon: Banknote, accent: 'from-emerald-500/20 to-emerald-600/5', iconColor: 'text-emerald-300' },
    { label: 'Pending', value: pending, icon: Clock, accent: 'from-amber-500/20 to-amber-600/5', iconColor: 'text-amber-300' },
    { label: 'Customers', value: uniqueCustomers.size, icon: Users, accent: 'from-violet-500/20 to-violet-600/5', iconColor: 'text-violet-300' },
    { label: 'Paid', value: paid, icon: CheckCircle2, accent: 'from-cyan-500/20 to-cyan-600/5', iconColor: 'text-cyan-300' },
    { label: 'Completed', value: completed, icon: ArrowUpRight, accent: 'from-green-500/20 to-green-600/5', iconColor: 'text-green-300' },
    { label: 'Cancelled', value: cancelled, icon: ArrowDownRight, accent: 'from-rose-500/20 to-rose-600/5', iconColor: 'text-rose-300' },
    { label: 'Games', value: games.length, icon: Gamepad2, accent: 'from-indigo-500/20 to-indigo-600/5', iconColor: 'text-indigo-300' },
  ];

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div><h1 className="font-display text-2xl font-bold">Overview</h1><p className="text-xs text-slate-500">Live metrics from your database</p></div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-lg border border-[#253451] px-3 py-2 text-slate-400">Last 100 orders</span>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Could not load live data: {error}. Showing empty state.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl border border-[#1b2a45] bg-gradient-to-br ${c.accent} p-4`}>
            <div className="flex items-center justify-between"><span className="text-[11px] uppercase tracking-wider text-slate-400">{c.label}</span><c.icon size={16} className={c.iconColor} /></div>
            <p className="font-display mt-3 text-2xl font-bold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <h2 className="font-display mb-4 text-sm font-semibold">Recent Orders</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="pb-2 font-medium">Reference</th><th className="pb-2 font-medium">Customer</th><th className="pb-2 font-medium">Game</th><th className="pb-2 font-medium">Status</th><th className="pb-2 text-right font-medium">Total</th></tr></thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-600">No orders yet. Orders from the storefront will appear here.</td></tr>}
                {orders.slice(0, 12).map((o) => (
                  <tr key={o.id} className="border-b border-[#0f1b31]">
                    <td className="py-3 font-mono text-cyan-300">{o.reference}</td>
                    <td className="py-3 text-slate-300">{o.email}</td>
                    <td className="py-3 text-slate-400">{o.games?.name || '—'}</td>
                    <td className={`py-3 font-medium ${statusColor[o.status] || 'text-slate-400'}`}>{o.status}</td>
                    <td className="py-3 text-right font-medium">{fmtP(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <h2 className="font-display mb-4 text-sm font-semibold">Catalog</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><Gamepad2 size={14} className="text-cyan-300" /> Games</span><span className="font-display font-bold text-slate-200">{games.length}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><Package size={14} className="text-violet-300" /> Packages</span><span className="font-display font-bold text-slate-200">{packages.length}</span></div>
              <div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-2"><XCircle size={14} className="text-rose-300" /> Cancelled</span><span className="font-display font-bold text-slate-200">{cancelled}</span></div>
            </div>
          </div>
          <GamesVisibilityPanel initialGames={games.map((g) => ({ id: g.id, name: g.name, slug: g.slug, is_active: g.is_active, is_featured: g.is_featured }))} />
        </div>
      </div>
    </div>
  );
}

import { adminSupabase } from '@/lib/supabaseAdmin';
import { BarChart3, TrendingUp, Users, Wallet } from 'lucide-react';
import { hasAdminPagePermission } from '@/lib/adminGuard';
import { AdminPermissionDenied } from '@/components/admin/AdminPermissionDenied';

export const dynamic = 'force-dynamic';

export default async function AdminAnalyticsPage() {
  if (!await hasAdminPagePermission('analytics.view')) return <AdminPermissionDenied feature="analytics" />;
  let metrics = { totalOrders: 0, revenue: 0, avgOrder: 0, customers: 0, topGames: [] as Array<{ name: string; count: number }>, topPackages: [] as Array<{ name: string; count: number }> };
  let dbReady = false;
  if (adminSupabase) {
    dbReady = true;
    const { data: orders } = await adminSupabase.from('orders').select('id, total_cents, status, email, games(name), packages(name)');
    const rows = (orders || []) as unknown as Array<{ id: string; total_cents: number; status: string; email: string; games?: { name: string } | null; packages?: { name: string } | null }>;
    const paid = rows.filter((o) => ['PAID','COMPLETED','PROCESSING'].includes(o.status));
    const revenue = paid.reduce((s, o) => s + o.total_cents, 0);
    const gameMap = new Map<string, number>();
    const pkgMap = new Map<string, number>();
    for (const o of rows) { if (o.games?.name) gameMap.set(o.games.name, (gameMap.get(o.games.name) || 0) + 1); if (o.packages?.name) pkgMap.set(o.packages.name, (pkgMap.get(o.packages.name) || 0) + 1); }
    metrics = { totalOrders: rows.length, revenue, avgOrder: paid.length ? Math.round(revenue / paid.length) : 0, customers: new Set(rows.map((r) => r.email.toLowerCase())).size, topGames: Array.from(gameMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5), topPackages: Array.from(pkgMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5) };
  }
  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  const cards = [{ label: 'Total Orders', value: metrics.totalOrders, icon: BarChart3, color: 'text-blue-300' }, { label: 'Revenue', value: fmtP(metrics.revenue), icon: Wallet, color: 'text-emerald-300' }, { label: 'Avg Order Value', value: fmtP(metrics.avgOrder), icon: TrendingUp, color: 'text-cyan-300' }, { label: 'Customers', value: metrics.customers, icon: Users, color: 'text-violet-300' }];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Analytics</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Analytics</h1>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><c.icon size={18} className={c.color} /><p className="mt-3 text-xs text-slate-500">{c.label}</p><p className="font-display text-xl font-bold">{c.value}</p></div>
        ))}</div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><h2 className="font-display mb-4 text-sm font-semibold">Top Games</h2>{!dbReady ? <p className="text-sm text-slate-500">Database not configured.</p> : metrics.topGames.length === 0 ? <p className="text-sm text-slate-600">No data yet.</p> : <div className="space-y-2">{metrics.topGames.map((g, i) => <div key={g.name} className="flex items-center gap-3"><span className="text-xs text-slate-500">{i + 1}</span><span className="flex-1 text-sm">{g.name}</span><div className="h-2 w-24 rounded-full bg-[#1b2a45]"><div className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-600" style={{ width: `${(g.count / metrics.topGames[0].count) * 100}%` }} /></div><span className="text-xs text-slate-400">{g.count}</span></div>)}</div>}</div>
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><h2 className="font-display mb-4 text-sm font-semibold">Top Packages</h2>{!dbReady ? <p className="text-sm text-slate-500">Database not configured.</p> : metrics.topPackages.length === 0 ? <p className="text-sm text-slate-600">No data yet.</p> : <div className="space-y-2">{metrics.topPackages.map((p, i) => <div key={p.name} className="flex items-center gap-3"><span className="text-xs text-slate-500">{i + 1}</span><span className="flex-1 text-sm">{p.name}</span><div className="h-2 w-24 rounded-full bg-[#1b2a45]"><div className="h-2 rounded-full bg-gradient-to-r from-violet-400 to-violet-600" style={{ width: `${(p.count / metrics.topPackages[0].count) * 100}%` }} /></div><span className="text-xs text-slate-400">{p.count}</span></div>)}</div>}</div>
        </div>
      </div>
    </main>
  );
}

import { requireAdminPageSession } from '@/lib/adminGuard';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getOperationalHealth } from '@/lib/operationalHealth';
import { Shield, Database, Mail, CreditCard, Server } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminSystemHealthPage() {
  await requireAdminPageSession('ADMIN', 'SUPER_ADMIN');
  const observed = await getOperationalHealth(adminSupabase);
  const services = [
    ...observed.map((signal) => ({ ...signal, icon: signal.name === 'Database' ? Database : Mail, color: signal.status === 'ok' ? 'text-emerald-300' : signal.status === 'degraded' ? 'text-amber-300' : 'text-slate-400' })),
    ...[{ name: 'Payments', icon: CreditCard }, { name: 'Storage', icon: Server }, { name: 'Email delivery', icon: Mail }].map((service) => ({ ...service, status: 'unknown', color: 'text-slate-400', detail: 'No live provider probe configured.' })),
    { name: 'Application', icon: Shield, status: 'ok', color: 'text-emerald-300', detail: 'This server request completed.' },
  ];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">System Health</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">System Health</h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{services.map((s) => (
          <div key={s.name} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><div className="flex items-center justify-between"><s.icon size={18} className={s.color} /><span className={`text-xs font-semibold ${s.color}`}>{s.status}</span></div><h3 className="font-display mt-3 font-semibold">{s.name}</h3><p className="text-xs text-slate-500">{s.detail}</p></div>
        ))}</div>
      </div>
    </main>
  );
}

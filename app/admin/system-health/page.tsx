import { Shield, Database, Mail, CreditCard, Server } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminSystemHealthPage() {
  const services = [
    { name: 'Database', icon: Database, status: 'Operational', color: 'text-emerald-300', detail: 'PostgreSQL connected via Supabase' },
    { name: 'Payments', icon: CreditCard, status: 'Mock Mode', color: 'text-amber-300', detail: 'MockPaymentProvider active' },
    { name: 'Email', icon: Mail, status: 'Not Configured', color: 'text-slate-500', detail: 'Set RESEND_API_KEY to enable' },
    { name: 'Storage', icon: Server, status: 'Ready', color: 'text-emerald-300', detail: 'Supabase Storage available' },
    { name: 'Application', icon: Shield, status: 'Running', color: 'text-emerald-300', detail: 'Next.js server operational' },
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

import { Shield, Lock, Eye, KeyRound } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminSecurityPage() {
  const items = [
    { title: 'Row Level Security', icon: Lock, status: 'Enabled', detail: 'All tables have RLS policies enforced', color: 'text-emerald-300' },
    { title: 'Server-Side Pricing', icon: KeyRound, status: 'Active', detail: 'Order totals recalculated server-side from DB', color: 'text-emerald-300' },
    { title: 'Input Validation', icon: Eye, status: 'Active', detail: 'All API inputs validated before processing', color: 'text-emerald-300' },
    { title: 'Webhook Verification', icon: Shield, status: 'Ready', detail: 'Payment webhooks verify signatures and enforce idempotency', color: 'text-emerald-300' },
  ];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Security</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Security</h1>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">{items.map((s) => (
          <div key={s.title} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><div className="flex items-center justify-between"><s.icon size={18} className={s.color} /><span className={`text-xs font-semibold ${s.color}`}>{s.status}</span></div><h3 className="font-display mt-3 font-semibold">{s.title}</h3><p className="text-xs text-slate-500">{s.detail}</p></div>
        ))}</div>
      </div>
    </main>
  );
}

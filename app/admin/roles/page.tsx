import { Lock, Users, KeyRound } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminRolesPage() {
  const roles = [
    { name: 'CUSTOMER', permissions: ['orders.view', 'tickets.create'], color: 'text-slate-300' },
    { name: 'STAFF', permissions: ['orders.view', 'orders.edit', 'games.manage', 'customers.view', 'tickets.manage'], color: 'text-blue-300' },
    { name: 'ADMIN', permissions: ['orders.view', 'orders.edit', 'orders.refund', 'games.manage', 'pricing.manage', 'customers.manage', 'payments.view', 'payments.refund', 'staff.manage', 'tickets.manage', 'analytics.view'], color: 'text-violet-300' },
    { name: 'SUPER_ADMIN', permissions: ['*'], color: 'text-cyan-300' },
  ];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Roles & Permissions</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Roles & Permissions</h1>
        <div className="mt-6 grid gap-3 md:grid-cols-2">{roles.map((r) => (
          <div key={r.name} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><div className="flex items-center gap-2"><Lock size={16} className={r.color} /><h3 className="font-display font-semibold">{r.name}</h3></div><div className="mt-3 flex flex-wrap gap-1.5">{r.permissions.map((p) => <span key={p} className="rounded bg-[#13243f] px-2 py-0.5 text-[10px] text-slate-400">{p}</span>)}</div></div>
        ))}</div>
      </div>
    </main>
  );
}

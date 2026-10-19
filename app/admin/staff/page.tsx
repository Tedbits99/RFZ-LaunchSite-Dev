import { UserCog } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminStaffPage() {
  const staff = [
    { name: 'Admin', email: 'admin@runfazone.com', role: 'SUPER_ADMIN', status: 'Active' },
    { name: 'Demo Customer', email: 'demo@runfazone.com', role: 'CUSTOMER', status: 'Active' },
  ];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Staff</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="flex items-center justify-between"><div><h1 className="font-display text-2xl font-bold">Staff</h1><p className="text-xs text-slate-500">Manage team members</p></div><button className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold">+ Invite Staff</button></div>
        <div className="mt-6 space-y-3">{staff.map((s) => (
          <div key={s.email} className="flex items-center gap-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><UserCog className="text-cyan-300" size={18} /><div className="flex-1"><h3 className="font-display font-semibold">{s.name}</h3><p className="text-xs text-slate-400">{s.email}</p></div><span className="rounded bg-[#13243f] px-2 py-0.5 text-[10px] text-slate-400">{s.role}</span><span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">{s.status}</span></div>
        ))}</div>
      </div>
    </main>
  );
}

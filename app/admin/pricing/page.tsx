import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPageSession } from '@/lib/adminGuard';
import { Megaphone } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminPromotionsPage() {
  await requireAdminPageSession();
  let promos: Array<{ id: string; title: string; body: string; target_type: string; is_active: boolean; sort_order: number }> = [];
  let dbReady = false;
  if (adminSupabase) { dbReady = true; const { data } = await adminSupabase.from('promotions').select('*').order('sort_order'); promos = (data || []) as typeof promos; }
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Promotions</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="flex items-center justify-between"><div><h1 className="font-display text-2xl font-bold">Promotions</h1><p className="text-xs text-slate-500">Manage promotional banners</p></div><button className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold">+ Add Promotion</button></div>
        {!dbReady ? <p className="mt-8 text-sm text-slate-500">Database not configured.</p> :
          <div className="mt-6 grid gap-3 sm:grid-cols-2">{promos.map((p) => (
            <div key={p.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><div className="flex items-center justify-between"><Megaphone className="text-violet-300" size={18} /><span className={`rounded-full px-2 py-0.5 text-[10px] ${p.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></div><h3 className="font-display mt-3 font-semibold">{p.title}</h3><p className="text-xs text-slate-400">{p.body}</p><span className="mt-2 inline-block rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300">{p.target_type}</span></div>
          ))}</div>}
      </div>
    </main>
  );
}

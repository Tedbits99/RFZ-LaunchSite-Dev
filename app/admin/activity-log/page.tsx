import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPageSession } from '@/lib/adminGuard';
import { Activity } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminActivityLogPage() {
  await requireAdminPageSession();
  let orders: Array<{ id: string; reference: string; status: string; email: string; created_at: string }> = [];
  let dbReady = false;
  if (adminSupabase) { dbReady = true; const { data } = await adminSupabase.from('orders').select('id, reference, status, email, created_at').order('created_at', { ascending: false }).limit(30); orders = (data || []) as typeof orders; }
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Activity Log</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Activity Log</h1>
        {!dbReady ? <p className="mt-8 text-sm text-slate-500">Database not configured.</p> :
          <div className="mt-6 space-y-2">{orders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-3 text-xs"><Activity size={14} className="text-cyan-300" /><span className="font-mono text-cyan-300">{o.reference}</span><span className="text-slate-400">created by {o.email}</span><span className="ml-auto text-slate-500">{new Date(o.created_at).toLocaleString()}</span></div>
          ))}{orders.length === 0 && <p className="text-sm text-slate-600">No activity yet.</p>}</div>}
      </div>
    </main>
  );
}

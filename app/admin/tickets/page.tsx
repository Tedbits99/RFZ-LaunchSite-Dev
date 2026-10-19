import { adminSupabase } from '@/lib/supabaseAdmin';
import { Ticket } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminTicketsPage() {
  let tickets: Array<{ id: string; reference: string; email: string; subject: string; status: string; priority: string; created_at: string }> = [];
  let dbReady = false;
  if (adminSupabase) { dbReady = true; const { data } = await adminSupabase.from('support_tickets').select('*').order('updated_at', { ascending: false }).limit(50); tickets = (data || []) as typeof tickets; }
  const statusColor: Record<string, string> = { OPEN: 'text-amber-300', IN_PROGRESS: 'text-blue-300', WAITING_CUSTOMER: 'text-orange-300', RESOLVED: 'text-emerald-300', CLOSED: 'text-slate-400' };
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Support Tickets</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Support Tickets</h1>
        {!dbReady ? <p className="mt-8 text-sm text-slate-500">Database not configured.</p> :
          <div className="mt-6 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs"><thead className="text-slate-500"><tr className="border-b border-[#1b2a45]"><th className="p-4 font-medium">Reference</th><th className="p-4 font-medium">Email</th><th className="p-4 font-medium">Subject</th><th className="p-4 font-medium">Status</th><th className="p-4 font-medium">Priority</th><th className="p-4 font-medium">Date</th></tr></thead>
              <tbody>{tickets.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-600">No tickets yet.</td></tr>}{tickets.map((t) => (
                <tr key={t.id} className="border-b border-[#0f1b31]"><td className="p-4 font-mono text-cyan-300">{t.reference}</td><td className="p-4 text-slate-300">{t.email}</td><td className="p-4 text-slate-400">{t.subject}</td><td className={`p-4 font-medium ${statusColor[t.status] || 'text-slate-400'}`}>{t.status}</td><td className="p-4 text-slate-500">{t.priority}</td><td className="p-4 text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td></tr>
              ))}</tbody>
            </table>
          </div>}
      </div>
    </main>
  );
}

import { ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminRiskAlertsPage() {
  const alerts = [
    { type: 'Repeated Failed Payments', severity: 'MEDIUM', description: 'Monitor orders with multiple failed payment attempts.', active: true },
    { type: 'Excessive Order Attempts', severity: 'LOW', description: 'Rate limit order creation per email within a time window.', active: true },
    { type: 'Unusually Large Orders', severity: 'HIGH', description: 'Flag orders above ₱10,000 for manual review.', active: true },
    { type: 'Voucher Abuse', severity: 'MEDIUM', description: 'Detect repeated voucher usage from the same email.', active: true },
  ];
  const sevColor: Record<string, string> = { LOW: 'text-blue-300', MEDIUM: 'text-amber-300', HIGH: 'text-rose-300' };
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Risk Alerts</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Risk Alerts</h1>
        <p className="text-xs text-slate-500">Configurable risk monitoring rules</p>
        <div className="mt-6 space-y-3">{alerts.map((a) => (
          <div key={a.type} className="flex items-start gap-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><ShieldAlert className={`mt-1 ${sevColor[a.severity]}`} size={18} /><div className="flex-1"><div className="flex items-center justify-between"><h3 className="font-display font-semibold">{a.type}</h3><span className={`text-[10px] font-semibold ${sevColor[a.severity]}`}>{a.severity}</span></div><p className="text-xs text-slate-400">{a.description}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${a.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>{a.active ? 'Active' : 'Inactive'}</span></div>
        ))}</div>
      </div>
    </main>
  );
}

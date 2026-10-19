import { adminSupabase } from '@/lib/supabaseAdmin';
import { Settings } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function AdminSettingsPage() {
  const settings = [
    { key: 'NEXT_PUBLIC_APP_URL', label: 'Store URL', value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000', editable: false },
    { key: 'PAYMENT_PROVIDER', label: 'Payment Provider', value: process.env.PAYMENT_PROVIDER || 'mock', editable: false },
    { key: 'RESEND_API_KEY', label: 'Email (Resend) Key', value: process.env.RESEND_API_KEY ? '••••••••' : 'Not set', editable: false },
    { key: 'STRIPE_SECRET_KEY', label: 'Stripe Secret Key', value: process.env.STRIPE_SECRET_KEY ? '••••••••' : 'Not set', editable: false },
  ];
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95"><div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><a href="/admin" className="text-xs text-slate-400">← Dashboard</a><span className="text-slate-600">/</span><span className="text-sm font-semibold">Settings</span></div><a href="/" className="text-xs text-slate-400">View Store</a></div></header>
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="text-xs text-slate-500">Environment configuration. Update via your hosting provider.</p>
        <div className="mt-6 space-y-3">{settings.map((s) => (
          <div key={s.key} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-medium"><Settings size={14} className="text-cyan-300" />{s.label}</span><code className="text-[10px] text-slate-600">{s.key}</code></div><p className="mt-2 text-sm text-slate-400">{s.value}</p></div>
        ))}</div>
      </div>
    </main>
  );
}

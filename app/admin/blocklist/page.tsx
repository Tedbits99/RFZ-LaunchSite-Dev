import { AlertTriangle } from 'lucide-react'
import { AdminPage } from '@/components/admin/AdminPage'

export const dynamic = 'force-dynamic'

export default function AdminBlocklistPage() {
  return <AdminPage title="Blocklist"><section className="mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-6" aria-labelledby="blocklist-owner-required">
    <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Owner required</p>
    <h1 id="blocklist-owner-required" className="mt-2 font-display text-2xl font-bold">Blocklist policy is not defined</h1>
    <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-300"><AlertTriangle className="mt-1 shrink-0 text-amber-300" size={18} aria-hidden="true" /><p>No blocklist table, API, or checkout/auth enforcement consumer exists in repository migrations or application code. Storing arbitrary entries without a specified enforcement point would create a misleading security control.</p></div>
    <p className="mt-4 text-sm text-slate-400">Owner decisions needed: supported identifiers (account, normalized email, IP, or others), trusted source of identity, normalization and privacy/retention, which operations are blocked, exception handling, and audit/removal policy.</p>
  </section></AdminPage>
}

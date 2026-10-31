import { AlertTriangle } from 'lucide-react'
import { AdminPage } from '@/components/admin/AdminPage'

export const dynamic = 'force-dynamic'

export default function AdminRiskAlertsPage() {
  return <AdminPage title="Risk alerts"><section className="mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-6" aria-labelledby="risk-owner-required">
    <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Owner required</p>
    <h1 id="risk-owner-required" className="mt-2 font-display text-2xl font-bold">Risk monitoring is not configured</h1>
    <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-300"><AlertTriangle className="mt-1 shrink-0 text-amber-300" size={18} aria-hidden="true" /><p>The prior page showed hard-coded rules as active, but no risk-rule schema, scheduler, signal queries, or enforcement flow exists. No active alerts are claimed.</p></div>
    <p className="mt-4 text-sm text-slate-400">Owner decisions needed: risk signals and thresholds, time windows, alert destination, severity semantics, retention, false-positive review, and whether a signal only alerts or blocks an operation.</p>
  </section></AdminPage>
}

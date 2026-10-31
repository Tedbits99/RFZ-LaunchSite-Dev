import { AlertTriangle } from 'lucide-react'
import { AdminPage } from '@/components/admin/AdminPage'

export const dynamic = 'force-dynamic'

export default function AdminApprovalsPage() {
  return <AdminPage title="Approvals"><section className="mx-auto max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-6" aria-labelledby="approval-owner-required">
    <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Owner required</p>
    <h1 id="approval-owner-required" className="mt-2 font-display text-2xl font-bold">Approval policy is not defined</h1>
    <div className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-300"><AlertTriangle className="mt-1 shrink-0 text-amber-300" size={18} aria-hidden="true" /><p>No generic approvals table or request-producing workflow exists in the repository migrations. Sensitive RF Coins actions have a separate database-level dual-admin rule; this page must not imply that refunds, prices, or role changes are held for approval.</p></div>
    <p className="mt-4 text-sm text-slate-400">Before implementing general approvals, the owner must specify which actions require approval, who may request and approve them, whether the approver must be distinct, expiry/cancellation behavior, and how pending requests affect the underlying operation.</p>
  </section></AdminPage>
}

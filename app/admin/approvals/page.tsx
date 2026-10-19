import { adminSupabase } from '@/lib/supabaseAdmin'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { CheckSquare } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Approval = {
  id: string
  type: string
  resource_id: string
  requested_by: string
  status: string
  approver_email: string | null
  reason: string
  decided_at: string | null
  created_at: string
}

const statusColor: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-300',
  APPROVED: 'bg-emerald-500/20 text-emerald-300',
  REJECTED: 'bg-rose-500/20 text-rose-300',
}

export default async function AdminApprovalsPage() {
  let approvals: Approval[] = []
  let dbReady = false
  if (adminSupabase) {
    dbReady = true
    const { data } = await adminSupabase.from('approvals').select('*').order('created_at', { ascending: false })
    approvals = (data || []) as Approval[]
  }

  return (
    <AdminPage title="Approvals">
      <PageHeader title="Approvals" subtitle="Approval workflow for sensitive actions" />

      {!dbReady ? (
        <DbNotReady />
      ) : approvals.length === 0 ? (
        <EmptyState icon={CheckSquare} label="No approval requests" hint="Refunds, price changes, and role changes will appear here." />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <div key={a.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor[a.status] || 'text-slate-400'}`}>{a.status}</span>
                  <span className="text-xs font-medium text-slate-300">{a.type.replace('_', ' ')}</span>
                </div>
                <span className="text-[10px] text-slate-600">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div><span className="text-slate-600">Requested by:</span> <span className="text-slate-300">{a.requested_by}</span></div>
                <div><span className="text-slate-600">Resource:</span> <span className="font-mono text-cyan-300">{a.resource_id.slice(0, 8)}</span></div>
                <div><span className="text-slate-600">Approver:</span> <span className="text-slate-300">{a.approver_email || '—'}</span></div>
              </div>
              {a.reason && <p className="mt-2 text-xs text-slate-400">{a.reason}</p>}
              {a.decided_at && <p className="mt-1 text-[10px] text-slate-600">Decided: {new Date(a.decided_at).toLocaleString()}</p>}
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  )
}

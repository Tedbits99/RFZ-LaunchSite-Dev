import { adminSupabase } from '@/lib/supabaseAdmin'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { formatCurrency, formatNumber } from '@/lib/format'
import { Scale, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { hasAdminPagePermission } from '@/lib/adminGuard'
import { AdminPermissionDenied } from '@/components/admin/AdminPermissionDenied'

export const dynamic = 'force-dynamic'

type Order = { id: string; reference: string; total_cents: number; status: string; payment_method: string }

export default async function AdminReconciliationPage() {
  if (!await hasAdminPagePermission('payments.view')) return <AdminPermissionDenied feature="payment reconciliation" />
  let orders: Order[] = []
  let dbReady = false
  if (adminSupabase) {
    dbReady = true
    const { data } = await adminSupabase
      .from('orders')
      .select('id, reference, total_cents, status, payment_method')
      .order('created_at', { ascending: false })
      .limit(500)
    orders = (data || []) as Order[]
  }

  const paidOrders = orders.filter((o) => ['PAID', 'COMPLETED', 'PROCESSING'].includes(o.status))
  const pendingOrders = orders.filter((o) => ['WAITING_PAYMENT'].includes(o.status))
  const failedOrders = orders.filter((o) => ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(o.status))
  const matched = paidOrders.length
  const unmatched = pendingOrders.length
  const missing = failedOrders.length

  const stats = [
    { label: 'Matched (Paid)', value: formatNumber(matched), icon: CheckCircle2, color: 'text-emerald-300' },
    { label: 'Unmatched (Pending)', value: formatNumber(unmatched), icon: AlertTriangle, color: 'text-amber-300' },
    { label: 'Missing (Failed)', value: formatNumber(missing), icon: XCircle, color: 'text-rose-300' },
  ]

  return (
    <AdminPage title="Reconciliation">
      <PageHeader title="Reconciliation" subtitle="Compare database orders against provider transactions" />

      {!dbReady ? (
        <DbNotReady />
      ) : orders.length === 0 ? (
        <EmptyState icon={Scale} label="No orders to reconcile" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-slate-400">{s.label}</span>
                  <s.icon size={16} className={s.color} />
                </div>
                <p className="font-display mt-3 text-2xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-[#1b2a45]">
                  <th className="p-4 font-medium">Reference</th>
                  <th className="p-4 text-right font-medium">DB Amount</th>
                  <th className="p-4 font-medium">Method</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 50).map((o) => (
                  <tr key={o.id} className="border-b border-[#0f1b31]">
                    <td className="p-4 font-mono text-cyan-300">{o.reference}</td>
                    <td className="p-4 text-right font-medium">{formatCurrency(o.total_cents)}</td>
                    <td className="p-4 text-slate-400">{o.payment_method}</td>
                    <td className="p-4 text-slate-400">{o.status}</td>
                    <td className="p-4">
                      {['PAID', 'COMPLETED', 'PROCESSING'].includes(o.status) ? (
                        <span className="text-[10px] text-emerald-300">Matched</span>
                      ) : ['WAITING_PAYMENT'].includes(o.status) ? (
                        <span className="text-[10px] text-amber-300">Unmatched</span>
                      ) : (
                        <span className="text-[10px] text-rose-300">Missing payment</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminPage>
  )
}

import { supabase } from '@/lib/supabase'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { formatCurrency } from '@/lib/format'
import PaymentConfigEditor from './PaymentConfigEditor'
import { CreditCard } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Order = {
  id: string
  reference: string
  email: string
  total_cents: number
  payment_method: string
  status: string
  created_at: string
}

const statusColor: Record<string, string> = {
  PENDING: 'text-amber-300',
  PAYMENT_PENDING: 'text-amber-200',
  PAID: 'text-emerald-300',
  PROCESSING: 'text-blue-300',
  COMPLETED: 'text-emerald-400',
  CANCELLED: 'text-rose-300',
  FAILED: 'text-rose-400',
  REFUND_REQUESTED: 'text-orange-300',
  REFUNDED: 'text-slate-400',
}

type EditorConfig = {
  id: string
  method_key: string
  display_name: string
  provider: string
  provider_type: string
  provider_name: string
  is_test_mode: boolean
  test_mode: boolean
  is_enabled: boolean
  account_name: string
  account_number: string
  qr_data: string | null
  instructions: string
  webhook_url: string | null
  api_url: string
  currency: string
  supported_methods: string[]
  sort_order: number
  min_amount_cents: number | null
  max_amount_cents: number | null
  notes: string
  logo_url: string | null
}

export default async function AdminPaymentsPage() {
  let orders: Order[] = []
  let configs: EditorConfig[] = []
  let dbReady = false
  const db = adminSupabase || supabase
  if (db) {
    dbReady = true
    const [ordersRes, configsRes] = await Promise.all([
      db
        .from('orders')
        .select('id, reference, email, total_cents, payment_method, status, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .rpc('admin_get_all_payment_config'),
    ])
    orders = (ordersRes.data || []) as Order[]
    configs = (configsRes.data || []) as unknown as EditorConfig[]
  }

  return (
    <AdminPage title="Payments">
      <PageHeader title="Payments" subtitle="Payment records and provider settings" />

      {!dbReady ? (
        <DbNotReady />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="font-display text-sm font-semibold text-slate-200">Payment Methods</h2>
            <p className="mt-1 text-[10px] text-slate-500">Configure providers here. Update a method&apos;s provider fields when you connect its API.</p>
            <div className="mt-4">
              <PaymentConfigEditor initialConfigs={configs} />
            </div>
          </section>

          <section>
            <h2 className="font-display text-sm font-semibold text-slate-200">Recent Payments</h2>
            {orders.length === 0 ? (
              <div className="mt-4">
                <EmptyState icon={CreditCard} label="No payments yet" hint="Payments appear here after orders are placed." />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr className="border-b border-[#1b2a45]">
                      <th className="p-4 font-medium">Payment ID</th>
                      <th className="p-4 font-medium">Order Ref</th>
                      <th className="p-4 font-medium">Customer</th>
                      <th className="p-4 font-medium">Method</th>
                      <th className="p-4 text-right font-medium">Amount</th>
                      <th className="p-4 font-medium">Status</th>
                      <th className="p-4 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                        <td className="p-4 font-mono text-cyan-300">{o.id.slice(0, 8)}</td>
                        <td className="p-4 font-mono text-slate-300">{o.reference}</td>
                        <td className="p-4 text-slate-400">{o.email}</td>
                        <td className="p-4 text-slate-400">{o.payment_method}</td>
                        <td className="p-4 text-right font-medium text-emerald-300">{formatCurrency(o.total_cents)}</td>
                        <td className={`p-4 font-medium ${statusColor[o.status] || 'text-slate-400'}`}>{o.status}</td>
                        <td className="p-4 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </AdminPage>
  )
}

import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPageSession } from '@/lib/adminGuard'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { Bell } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Notification = {
  id: string
  email: string
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
}

const typeColor: Record<string, string> = {
  new_order: 'text-cyan-300',
  payment_failure: 'text-rose-300',
  refund_request: 'text-amber-300',
  risk_alert: 'text-orange-300',
  support_ticket: 'text-blue-300',
  system: 'text-violet-300',
}

export default async function AdminNotificationsPage() {
  await requireAdminPageSession()
  let notifications: Notification[] = []
  let dbReady = false
  if (adminSupabase) {
    dbReady = true
    const { data } = await adminSupabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)
    notifications = (data || []) as Notification[]
  }

  const unread = notifications.filter((n) => !n.is_read).length

  return (
    <AdminPage title="Notifications">
      <PageHeader title="Notifications" subtitle={unread > 0 ? `${unread} unread` : 'All caught up'} />

      {!dbReady ? (
        <DbNotReady />
      ) : notifications.length === 0 ? (
        <EmptyState icon={Bell} label="No notifications" hint="System notifications will appear here." />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-xs ${
              n.is_read ? 'border-[#1b2a45] bg-[#0b1225]' : 'border-cyan-400/30 bg-cyan-400/5'
            }`}>
              <Bell size={14} className={`mt-0.5 shrink-0 ${typeColor[n.type] || 'text-slate-400'}`} />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{n.title}</span>
                  {!n.is_read && <span className="h-2 w-2 rounded-full bg-cyan-400" />}
                </div>
                {n.body && <p className="mt-0.5 text-slate-400">{n.body}</p>}
                <p className="mt-1 text-[10px] text-slate-600">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  )
}

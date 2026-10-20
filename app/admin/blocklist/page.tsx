import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPageSession } from '@/lib/adminGuard'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { Ban, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

type BlockEntry = {
  id: string
  value: string
  type: string
  reason: string
  is_active: boolean
  created_by: string
  created_at: string
}

const typeColor: Record<string, string> = {
  EMAIL: 'bg-blue-500/20 text-blue-300',
  IP: 'bg-amber-500/20 text-amber-300',
  USER: 'bg-violet-500/20 text-violet-300',
}

export default async function AdminBlocklistPage() {
  await requireAdminPageSession()
  let entries: BlockEntry[] = []
  let dbReady = false
  if (adminSupabase) {
    dbReady = true
    const { data } = await adminSupabase.from('blocklist').select('*').order('created_at', { ascending: false })
    entries = (data || []) as BlockEntry[]
  }

  return (
    <AdminPage title="Blocklist">
      <PageHeader
        title="Blocklist"
        subtitle="Manage blocked users, emails, and IPs"
        action={
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white">
            <Plus size={16} /> Add Entry
          </button>
        }
      />

      {!dbReady ? (
        <DbNotReady />
      ) : entries.length === 0 ? (
        <EmptyState icon={Ban} label="No blocked entries" hint="Add entries to block users, emails, or IPs." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr className="border-b border-[#1b2a45]">
                <th className="p-4 font-medium">Value</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Reason</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Created By</th>
                <th className="p-4 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                  <td className="p-4 font-mono text-slate-200">{e.value}</td>
                  <td className="p-4">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${typeColor[e.type] || 'text-slate-400'}`}>{e.type}</span>
                  </td>
                  <td className="p-4 text-slate-400">{e.reason || '—'}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${e.is_active ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-500/20 text-slate-400'}`}>
                      {e.is_active ? 'Blocked' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500">{e.created_by}</td>
                  <td className="p-4 text-slate-500">{new Date(e.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminPage>
  )
}

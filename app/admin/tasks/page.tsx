import { adminSupabase } from '@/lib/supabaseAdmin'
import { AdminPage } from '@/components/admin/AdminPage'
import { DbNotReady, EmptyState, PageHeader } from '@/components/admin/ui'
import { CalendarClock, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Task = {
  id: string
  title: string
  description: string
  assigned_to: string | null
  priority: string
  status: string
  due_date: string | null
  created_at: string
}

const statusColor: Record<string, string> = {
  TODO: 'bg-slate-500/20 text-slate-300',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-300',
  DONE: 'bg-emerald-500/20 text-emerald-300',
}

const priorityColor: Record<string, string> = {
  LOW: 'text-slate-400',
  NORMAL: 'text-slate-300',
  HIGH: 'text-amber-300',
  URGENT: 'text-rose-300',
}

export default async function AdminTasksPage() {
  let tasks: Task[] = []
  let dbReady = false
  if (adminSupabase) {
    dbReady = true
    const { data } = await adminSupabase.from('tasks').select('*').order('created_at', { ascending: false })
    tasks = (data || []) as Task[]
  }

  return (
    <AdminPage title="Tasks">
      <PageHeader
        title="Tasks"
        subtitle="Admin task management"
        action={
          <button className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white">
            <Plus size={16} /> Add Task
          </button>
        }
      />

      {!dbReady ? (
        <DbNotReady />
      ) : tasks.length === 0 ? (
        <EmptyState icon={CalendarClock} label="No tasks yet" hint="Create tasks to track work for your team." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {tasks.map((t) => (
            <div key={t.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
              <div className="flex items-start justify-between">
                <h3 className="font-display font-semibold text-slate-200">{t.title}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor[t.status] || 'text-slate-400'}`}>{t.status.replace('_', ' ')}</span>
              </div>
              {t.description && <p className="mt-2 text-xs text-slate-400">{t.description}</p>}
              <div className="mt-3 flex items-center justify-between text-[10px]">
                <span className={priorityColor[t.priority] || 'text-slate-400'}>{t.priority}</span>
                <span className="text-slate-600">{t.assigned_to || 'Unassigned'}</span>
              </div>
              {t.due_date && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <CalendarClock size={12} /> Due {new Date(t.due_date).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  )
}

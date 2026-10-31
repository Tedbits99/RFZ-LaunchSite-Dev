'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, CalendarClock, Plus, RotateCcw, Save } from 'lucide-react'

type Assignee = { id: string; name: string; email: string }
type Task = {
  id: string
  title: string
  description: string
  assigned_to_id: string | null
  priority: string
  status: string
  due_date: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  assignee: Assignee | null
}
type Draft = Pick<Task, 'title' | 'description' | 'assigned_to_id' | 'priority' | 'status' | 'due_date'>

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const STATUSES = ['TODO', 'IN_PROGRESS', 'DONE']

export default function AdminTasksClient() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('NORMAL')
  const [status, setStatus] = useState('TODO')
  const [assignedToId, setAssignedToId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/tasks' + (showArchived ? '?archived=true' : ''), { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Tasks could not be loaded.')
      const loadedTasks = (result.tasks || []) as Task[]
      setTasks(loadedTasks)
      setAssignees(result.assignees || [])
      setDrafts(Object.fromEntries(loadedTasks.map((task) => [task.id, {
        title: task.title,
        description: task.description,
        assigned_to_id: task.assigned_to_id,
        priority: task.priority,
        status: task.status,
        due_date: task.due_date,
      }])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tasks could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => { void load() }, [load])

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority, status, assignedToId: assignedToId || null, dueDate: dueDate || null }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Task could not be created.')
      setTitle('')
      setDescription('')
      setPriority('NORMAL')
      setStatus('TODO')
      setAssignedToId('')
      setDueDate('')
      setMessage('Task created and recorded in the admin audit log.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task could not be created.')
    } finally {
      setCreating(false)
    }
  }

  function changeDraft(id: string, key: keyof Draft, value: string | null) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [key]: value } }))
  }

  async function saveTask(id: string) {
    const draft = drafts[id]
    if (!draft) return
    setBusyId(id)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: draft.title, description: draft.description, assignedToId: draft.assigned_to_id, priority: draft.priority, status: draft.status, dueDate: draft.due_date }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Task could not be saved.')
      setMessage('Task saved and recorded in the admin audit log.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task could not be saved.')
    } finally {
      setBusyId(null)
    }
  }

  async function archiveTask(task: Task) {
    setBusyId(task.id)
    setError('')
    setMessage('')
    try {
      const response = task.archived_at
        ? await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, isArchived: false }) })
        : await fetch('/api/admin/tasks?id=' + encodeURIComponent(task.id), { method: 'DELETE' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Task could not be changed.')
      setMessage(task.archived_at ? 'Task restored.' : 'Task archived. Its history is retained.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Task could not be changed.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="tasks-title">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="tasks-title" className="font-display text-2xl font-bold">Admin tasks</h2>
          <p className="mt-1 text-sm text-slate-400">Task changes are persisted and audited. Archive keeps the record and its history.</p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-4 w-4 accent-cyan-400" />
          Show archived tasks
        </label>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{message}</p>}

      {!showArchived && (
        <form onSubmit={createTask} className="mb-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200"><Plus size={16} aria-hidden="true" /> Create task</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-xs text-slate-400">Title</span><input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm text-slate-100" /></label>
            <label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-xs text-slate-400">Description</span><textarea maxLength={4000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-100" /></label>
            <label><span className="mb-1 block text-xs text-slate-400">Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)} className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm text-slate-100">{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span className="mb-1 block text-xs text-slate-400">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm text-slate-100">{STATUSES.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></label>
            <label><span className="mb-1 block text-xs text-slate-400">Assign to</span><select value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm text-slate-100"><option value="">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email}</option>)}</select></label>
            <label><span className="mb-1 block text-xs text-slate-400">Due date</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm text-slate-100" /></label>
          </div>
          <button type="submit" disabled={creating} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 disabled:opacity-50"><Plus size={15} aria-hidden="true" />{creating ? 'Creating…' : 'Create task'}</button>
        </form>
      )}

      {loading ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-sm text-slate-400">Loading tasks…</p> : tasks.length === 0 ? (
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-center text-sm text-slate-400">{showArchived ? 'No archived tasks.' : 'No tasks yet. Create one above.'}</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tasks.map((task) => {
            const draft = drafts[task.id]
            const busy = busyId === task.id
            return (
              <form key={task.id} aria-label={`Task: ${task.title}`} onSubmit={(event) => { event.preventDefault(); void saveTask(task.id) }} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-xs text-slate-400" htmlFor={'task-title-' + task.id}>Title</label>
                    <input id={'task-title-' + task.id} required maxLength={160} value={draft?.title || ''} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'title', event.target.value)} className="min-h-10 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm font-semibold text-slate-100 disabled:opacity-70" />
                  </div>
                  <span className="shrink-0 rounded-full border border-[#22314d] px-2 py-1 text-[10px] text-slate-400">{task.archived_at ? 'Archived' : task.status.replace('_', ' ')}</span>
                </div>
                <label className="mb-3 block"><span className="mb-1 block text-xs text-slate-400">Description</span><textarea rows={3} maxLength={4000} value={draft?.description || ''} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'description', event.target.value)} className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200 disabled:opacity-70" /></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><span className="mb-1 block text-xs text-slate-400">Status</span><select value={draft?.status || 'TODO'} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'status', event.target.value)} className="min-h-10 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-xs text-slate-200">{STATUSES.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</select></label>
                  <label><span className="mb-1 block text-xs text-slate-400">Priority</span><select value={draft?.priority || 'NORMAL'} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'priority', event.target.value)} className="min-h-10 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-xs text-slate-200">{PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                  <label><span className="mb-1 block text-xs text-slate-400">Assign to</span><select value={draft?.assigned_to_id || ''} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'assigned_to_id', event.target.value || null)} className="min-h-10 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-xs text-slate-200"><option value="">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email}</option>)}</select></label>
                  <label><span className="mb-1 flex items-center gap-1 text-xs text-slate-400"><CalendarClock size={12} aria-hidden="true" />Due date</span><input type="date" value={draft?.due_date || ''} disabled={Boolean(task.archived_at) || busy} onChange={(event) => changeDraft(task.id, 'due_date', event.target.value || null)} className="min-h-10 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-xs text-slate-200 disabled:opacity-70" /></label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#17243c] pt-4">
                  {!task.archived_at && <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-cyan-500 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50"><Save size={14} aria-hidden="true" />{busy ? 'Saving…' : 'Save changes'}</button>}
                  <button type="button" disabled={busy} onClick={() => void archiveTask(task)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#253451] px-3 text-xs text-slate-200 hover:border-cyan-300 disabled:opacity-50">
                    {task.archived_at ? <RotateCcw size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}
                    {task.archived_at ? 'Restore' : 'Archive'}
                  </button>
                  <span className="ml-auto text-[10px] text-slate-500">Updated {new Date(task.updated_at).toLocaleString()}</span>
                </div>
              </form>
            )
          })}
        </div>
      )}
    </section>
  )
}

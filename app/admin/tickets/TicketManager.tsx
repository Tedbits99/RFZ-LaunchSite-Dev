'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type Ticket = { id: string; reference: string; email: string; subject: string; status: string; priority: string; created_at: string; updated_at: string }
type Message = { author: string; body: string; created_at: string }
const statuses = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export default function TicketManager() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [detailBusy, setDetailBusy] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/tickets', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Tickets could not be loaded.')
      setTickets((result.tickets || []) as Ticket[])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tickets could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function showDetail(id: string) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    setDetailBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/tickets?id=' + encodeURIComponent(id), { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Ticket messages could not be loaded.')
      setMessages((result.messages || []) as Message[])
    } catch (reason) {
      setMessages([])
      setError(reason instanceof Error ? reason.message : 'Ticket messages could not be loaded.')
    } finally {
      setDetailBusy(false)
    }
  }

  async function update(id: string, field: 'status' | 'priority', value: string) {
    setSavingId(id)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/admin/tickets', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Ticket could not be updated.')
      setTickets((current) => current.map((ticket) => ticket.id === id ? result.ticket as Ticket : ticket))
      setNotice('Ticket updated and audit event recorded.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ticket could not be updated.')
      await load()
    } finally {
      setSavingId(null)
    }
  }

  return <section className="space-y-5" aria-labelledby="tickets-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 id="tickets-title" className="font-display text-2xl font-bold">Support tickets</h1><p className="mt-1 text-sm text-slate-400">Review ticket history and update its existing status and priority fields.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#253451] px-4 text-sm text-slate-200"><RefreshCw size={14} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>

    <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">Customer replies are unavailable. The current schema has no secure customer ticket-ownership token or established reply/email workflow, so this admin surface does not send messages.</p>
    {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
    {loading && tickets.length === 0 ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading tickets…</p> : error && tickets.length === 0 ? null : tickets.length === 0 ? (
      <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-center text-sm text-slate-400">No support tickets yet.</div>
    ) : <div className="space-y-3">{tickets.map((ticket) => <article key={ticket.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem_12rem_auto] lg:items-end">
        <div className="min-w-0"><p className="font-mono text-xs text-cyan-300">{ticket.reference}</p><h2 className="mt-1 break-words text-sm font-semibold">{ticket.subject}</h2><p className="mt-1 break-all text-xs text-slate-400">{ticket.email}</p><p className="mt-1 text-xs text-slate-500">Received {new Date(ticket.created_at).toLocaleString()}</p></div>
        <label className="text-xs text-slate-400">Status<select value={ticket.status} disabled={savingId === ticket.id} onChange={(event) => void update(ticket.id, 'status', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#253451] bg-[#070d1c] px-3 text-sm text-white">{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="text-xs text-slate-400">Priority<select value={ticket.priority} disabled={savingId === ticket.id} onChange={(event) => void update(ticket.id, 'priority', event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#253451] bg-[#070d1c] px-3 text-sm text-white">{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
        <button type="button" aria-expanded={expanded === ticket.id} onClick={() => void showDetail(ticket.id)} className="min-h-11 rounded-lg border border-[#253451] px-4 text-sm text-cyan-200 hover:border-cyan-300">{expanded === ticket.id ? 'Hide history' : 'View history'}</button>
      </div>
      {expanded === ticket.id && <div className="mt-4 border-t border-[#1b2a45] pt-4"><h3 className="text-sm font-semibold">Conversation history</h3>{detailBusy ? <p role="status" className="mt-3 text-sm text-slate-400">Loading conversation…</p> : messages.length === 0 ? <p className="mt-3 text-sm text-slate-500">No messages recorded.</p> : <ol className="mt-3 space-y-3">{messages.map((message, index) => <li key={index} className="rounded-lg border border-[#17243c] p-3"><div className="flex justify-between gap-3 text-xs text-slate-500"><span>{message.author}</span><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">{message.body}</p></li>)}</ol>}</div>}
    </article>)}</div>}
  </section>
}

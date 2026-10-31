'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'

type AuditEvent = {
  id: string
  actor_id: string
  actor_email: string
  actor_role: string
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export default function AuditLogClient() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(nextPage: number) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/audit?page=' + nextPage, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Audit events could not be loaded.')
      setEvents(result.events || [])
      setHasMore(result.hasMore === true)
      setPage(nextPage)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audit events could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(0) }, [])

  return (
    <section aria-labelledby="audit-title">
      <div className="mb-5 flex items-start gap-3">
        <ShieldCheck className="mt-1 text-cyan-300" size={20} aria-hidden="true" />
        <div>
          <h2 id="audit-title" className="font-display text-2xl font-bold">Admin audit log</h2>
          <p className="mt-1 text-sm text-slate-400">Append-only events for audited admin operations. Entries cannot be edited or deleted through the app.</p>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {loading ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading audit events…</p> : events.length === 0 ? (
        <p className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">No admin audit events are recorded in this environment.</p>
      ) : (
        <>
          <div className="space-y-3">
            {events.map((event) => (
              <article key={event.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-slate-100">{event.action.replaceAll('_', ' ')}</h3>
                    <p className="mt-1 break-all text-xs text-slate-400">{event.actor_email} <span className="text-slate-600">({event.actor_role})</span></p>
                  </div>
                  <time dateTime={event.created_at} className="shrink-0 text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</time>
                </div>
                <p className="mt-3 text-xs text-slate-400">Target: <span className="font-mono text-cyan-200">{event.target_type}{event.target_id ? ' · ' + event.target_id : ''}</span></p>
                {Object.keys(event.metadata || {}).length > 0 && <pre className="mt-3 overflow-x-auto rounded-lg bg-black/20 p-3 text-[11px] text-slate-400">{JSON.stringify(event.metadata, null, 2)}</pre>}
              </article>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" disabled={loading || page === 0} onClick={() => void load(page - 1)} className="min-h-11 rounded-lg border border-[#253451] px-4 text-sm text-slate-200 disabled:opacity-40">Previous</button>
            <span className="text-xs text-slate-500">Page {page + 1}</span>
            <button type="button" disabled={loading || !hasMore} onClick={() => void load(page + 1)} className="min-h-11 rounded-lg border border-[#253451] px-4 text-sm text-slate-200 disabled:opacity-40">Next</button>
          </div>
        </>
      )}
    </section>
  )
}

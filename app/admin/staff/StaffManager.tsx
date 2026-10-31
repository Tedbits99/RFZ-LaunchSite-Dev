'use client'

import { useState } from 'react'
import { Plus, UserCog, X } from 'lucide-react'

export type AdminStaffRecord = {
  id: string
  email: string
  name: string
  role: string
  is_active: boolean
  claimed_at: string
}

const ROLES = ['STAFF', 'ADMIN', 'SUPER_ADMIN'] as const

export function StaffManager({ staff: initialStaff, actorId, actorRole }: {
  staff: AdminStaffRecord[]
  actorId: string
  actorRole: string
}) {
  const [staff, setStaff] = useState(initialStaff)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('STAFF')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function addStaff(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const response = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Staff membership could not be added.')
        return
      }
      setStaff((current) => [...current, result.admin as AdminStaffRecord].sort((a, b) => a.claimed_at.localeCompare(b.claimed_at)))
      setSuccess(`Added ${result.admin.email} as ${result.admin.role}.`)
      setName('')
      setEmail('')
      setRole('STAFF')
      setShowForm(false)
    } catch {
      setError('The request could not be completed. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  async function changeMember(member: AdminStaffRecord, patch: { role?: string; isActive?: boolean }) {
    setError('')
    setSuccess('')
    setBusyId(member.id)
    try {
      const response = await fetch('/api/admin/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, ...patch }),
      })
      const result = await response.json()
      if (!response.ok) {
        setError(result.error || 'Staff membership could not be updated.')
        return
      }
      setStaff((current) => current.map((entry) => entry.id === member.id ? result.admin as AdminStaffRecord : entry))
      setSuccess(`Updated ${result.admin.email}.`)
    } catch {
      setError('The request could not be completed. Please retry.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="staff-title">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="staff-title" className="font-display text-2xl font-bold">Staff access</h2>
          <p className="mt-1 text-xs text-slate-500">Add an existing confirmed account. This does not create a password or send email.</p>
        </div>
        <button type="button" onClick={() => setShowForm((value) => !value)} aria-expanded={showForm}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white">
          {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add staff</>}
        </button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {success && <p role="status" className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{success}</p>}

      {showForm && (
        <form onSubmit={addStaff} className="mb-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6">
          <h3 className="font-display mb-4 text-base font-semibold text-slate-200">Add existing account</h3>
          <p className="mb-4 text-xs text-slate-400">The email must belong to an existing confirmed RunFazone account. No invitation or email is sent.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block" htmlFor="staff-name">
              <span className="mb-1 block text-xs text-slate-400">Name</span>
              <input id="staff-name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)}
                autoComplete="name" className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200" />
            </label>
            <label className="block" htmlFor="staff-email">
              <span className="mb-1 block text-xs text-slate-400">Account email</span>
              <input id="staff-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)}
                autoComplete="email" className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200" />
            </label>
            <label className="block" htmlFor="staff-role">
              <span className="mb-1 block text-xs text-slate-400">Role</span>
              <select id="staff-role" value={role} onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])}
                className="min-h-11 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200">
                {(actorRole === 'SUPER_ADMIN' ? ROLES : ['STAFF'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" disabled={loading} className="mt-5 min-h-11 rounded-lg bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
            {loading ? 'Adding…' : 'Add staff access'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
        <table className="w-full min-w-[760px] text-left text-xs">
          <caption className="sr-only">Admin and staff access list</caption>
          <thead className="text-slate-500">
            <tr className="border-b border-[#1b2a45]">
              <th scope="col" className="p-4 font-medium">Name</th>
              <th scope="col" className="p-4 font-medium">Email</th>
              <th scope="col" className="p-4 font-medium">Role</th>
              <th scope="col" className="p-4 font-medium">Status</th>
              <th scope="col" className="p-4 font-medium">Added</th>
              <th scope="col" className="p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No admin accounts are configured.</td></tr>}
            {staff.map((member) => {
              const self = member.id === actorId
              const busy = busyId === member.id
              const canManageTarget = actorRole === 'SUPER_ADMIN' || (actorRole === 'ADMIN' && member.role === 'STAFF')
              return (
                <tr key={member.id} className="border-b border-[#0f1b31] last:border-0">
                  <td className="p-4 font-medium text-slate-200"><span className="inline-flex items-center gap-2"><UserCog size={14} aria-hidden="true" />{member.name || '—'}</span></td>
                  <td className="p-4 text-slate-400">{member.email}</td>
                  <td className="p-4">
                    <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.email}</label>
                    <select id={`role-${member.id}`} value={member.role} disabled={self || !canManageTarget || busy}
                      onChange={(event) => void changeMember(member, { role: event.target.value })}
                      className="min-h-9 rounded border border-[#22314d] bg-[#0a1124] px-2 text-xs text-slate-200 disabled:opacity-70">
                      {(actorRole === 'SUPER_ADMIN' ? ROLES : ['STAFF'] as const).map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </td>
                  <td className="p-4"><span className={member.is_active ? 'text-emerald-300' : 'text-slate-400'}>{member.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td className="p-4 text-slate-500">{new Date(member.claimed_at).toLocaleDateString()}</td>
                  <td className="p-4">
                    <button type="button" disabled={self || !canManageTarget || busy} onClick={() => void changeMember(member, { isActive: !member.is_active })}
                      className="min-h-9 rounded-lg border border-[#22314d] px-3 py-1 text-xs text-slate-200 hover:border-cyan-400/50 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy ? 'Saving…' : member.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {self && <span className="ml-2 text-[10px] text-slate-500">Current account</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

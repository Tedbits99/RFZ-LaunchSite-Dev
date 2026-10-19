'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

type AdminUser = {
  id: string
  email: string
  name: string
  role: string
  is_active: boolean
  last_login_at: string | null
  created_at: string
}

const ROLES = ['STAFF', 'ADMIN', 'SUPER_ADMIN'] as const

export function StaffManager({ staff }: { staff: AdminUser[] }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<typeof ROLES[number]>('STAFF')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create staff member.')
        return
      }
      setSuccess(`Created ${data.admin.email} as ${data.admin.role}.`)
      setName('')
      setEmail('')
      setPassword('')
      setRole('STAFF')
      setShowForm(false)
      // Reload the page to show the new staff member.
      window.location.reload()
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const toggleActive = async (id: string, currentActive: boolean) => {
    try {
      await fetch('/api/admin/staff', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: !currentActive }),
      })
      window.location.reload()
    } catch {
      // ignore
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Staff</h1>
          <p className="mt-1 text-xs text-slate-500">Manage team members and admin access</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white"
        >
          {showForm ? <><X size={16} /> Cancel</> : <><Plus size={16} /> Add Staff</>}
        </button>
      </div>

      {success && (
        <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-xs text-emerald-300">
          {success}
        </div>
      )}

      {showForm && (
        <form onSubmit={createStaff} className="mb-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
          <h2 className="font-display mb-4 text-sm font-semibold text-slate-300">Create New Admin Account</h2>
          {error && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2 text-xs text-rose-300">{error}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Full Name</span>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200 outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200 outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Password (min 8 chars)</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200 outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
                className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-4 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr className="border-b border-[#1b2a45]">
              <th className="p-4 font-medium">Name</th>
              <th className="p-4 font-medium">Email</th>
              <th className="p-4 font-medium">Role</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Last Login</th>
              <th className="p-4 font-medium">Joined</th>
              <th className="p-4 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                <td className="p-4 font-medium text-slate-200">{s.name || '—'}</td>
                <td className="p-4 text-slate-400">{s.email}</td>
                <td className="p-4">
                  <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    s.role === 'SUPER_ADMIN' ? 'bg-cyan-500/20 text-cyan-300' :
                    s.role === 'ADMIN' ? 'bg-violet-500/20 text-violet-300' :
                    'bg-blue-500/20 text-blue-300'
                  }`}>{s.role}</span>
                </td>
                <td className="p-4">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                    {s.is_active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td className="p-4 text-slate-500">{s.last_login_at ? new Date(s.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td className="p-4 text-slate-500">{new Date(s.created_at).toLocaleDateString()}</td>
                <td className="p-4">
                  <button
                    onClick={() => toggleActive(s.id, s.is_active)}
                    className="rounded-lg border border-[#22314d] px-2.5 py-1 text-[11px] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-300"
                  >
                    {s.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

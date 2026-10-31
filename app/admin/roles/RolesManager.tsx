'use client'

import { useEffect, useState } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'

type Permission = { key: string; label: string; area: string }
type Grant = { role: 'STAFF' | 'ADMIN'; permission_key: string; is_enabled: boolean }

export function RolesManager() {
  const [catalog, setCatalog] = useState<Permission[]>([])
  const [grants, setGrants] = useState<Grant[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/roles', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Role permissions could not be loaded.')
      setCatalog(result.catalog || [])
      setGrants(result.grants || [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Role permissions could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function setPermission(role: Grant['role'], permission: Permission, enabled: boolean) {
    const key = `${role}:${permission.key}`
    const previous = grants.find((grant) => grant.role === role && grant.permission_key === permission.key)?.is_enabled === true
    setSaving(key)
    setError('')
    setMessage('')
    setGrants((current) => {
      const found = current.some((grant) => grant.role === role && grant.permission_key === permission.key)
      return found
        ? current.map((grant) => grant.role === role && grant.permission_key === permission.key ? { ...grant, is_enabled: enabled } : grant)
        : [...current, { role, permission_key: permission.key, is_enabled: enabled }]
    })
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, permission: permission.key, enabled }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Permission change could not be saved.')
      setMessage(`${permission.label} ${enabled ? 'granted to' : 'removed from'} ${role}.`)
    } catch (reason) {
      setGrants((current) => {
        const found = current.some((grant) => grant.role === role && grant.permission_key === permission.key)
        return found
          ? current.map((grant) => grant.role === role && grant.permission_key === permission.key ? { ...grant, is_enabled: previous } : grant)
          : current
      })
      setError(reason instanceof Error ? reason.message : 'Permission change could not be saved.')
    } finally {
      setSaving(null)
    }
  }

  const areas = Array.from(new Set(catalog.map((permission) => permission.area)))
  return (
    <section aria-labelledby="permissions-title">
      <div className="mb-6 flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-1 text-cyan-300" size={20} />
        <div>
          <h2 id="permissions-title" className="font-display text-2xl font-bold">Role permissions</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">Changes are saved to the database, enforced by protected APIs, and recorded in the append-only admin audit log. Only a super admin can change grants. Super-admin access is fixed and cannot be edited here.</p>
        </div>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{message}</p>}

      {loading ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading permissions…</p> : error && catalog.length === 0 ? null : (
        <div className="space-y-5">
          {areas.map((area) => (
            <section key={area} aria-labelledby={`permission-area-${area.replaceAll(' ', '-')}`} className="overflow-hidden rounded-xl border border-[#1b2a45] bg-[#0b1225]">
              <h3 id={`permission-area-${area.replaceAll(' ', '-')}`} className="border-b border-[#1b2a45] px-4 py-3 text-sm font-semibold text-slate-200">{area}</h3>
              <div className="divide-y divide-[#14203a]">
                {catalog.filter((permission) => permission.area === area).map((permission) => (
                  <div key={permission.key} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center">
                    <div><p className="text-sm text-slate-200">{permission.label}</p><code className="text-[10px] text-slate-500">{permission.key}</code></div>
                    {(['STAFF', 'ADMIN'] as const).map((role) => {
                      const enabled = grants.find((grant) => grant.role === role && grant.permission_key === permission.key)?.is_enabled === true
                      const key = `${role}:${permission.key}`
                      return (
                        <label key={role} className="flex min-h-11 items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" aria-label={`Grant ${permission.label} to ${role}`} checked={enabled} disabled={saving !== null} onChange={(event) => void setPermission(role, permission, event.target.checked)} className="h-4 w-4 accent-cyan-400" />
                          <span>{role}{saving === key ? ' · saving' : ''}</span>
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          ))}
          <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-100">
            <LockKeyhole size={16} aria-hidden="true" />
            <span>SUPER_ADMIN retains all permissions as a protected, non-editable role.</span>
          </div>
        </div>
      )}
    </section>
  )
}

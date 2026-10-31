'use client'

import { useEffect, useState } from 'react'

type Policy = { enabled: boolean; updatedAt: string }

export default function CheckoutPolicyControl({ role }: { role: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/checkout-policy', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Checkout policy could not be read.')
      setPolicy(result as Policy)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Checkout policy could not be read.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function toggle() {
    if (!policy || role !== 'SUPER_ADMIN') return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/admin/checkout-policy', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !policy.enabled }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Checkout policy could not be saved.')
      setPolicy({ enabled: result.enabled, updatedAt: result.updatedAt })
      setNotice('Saved and recorded in checkout policy history.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Checkout policy could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5" aria-labelledby="guest-checkout-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 id="guest-checkout-title" className="font-display text-lg font-semibold">Guest checkout</h2>
        <p className="mt-1 text-sm text-slate-400">Controls the existing checkout policy used by order creation. Changes are database-audited.</p>
        {policy && <p className="mt-2 text-xs text-slate-500">Current state: {policy.enabled ? 'Enabled' : 'Disabled'} · last changed {new Date(policy.updatedAt).toLocaleString()}</p>}
      </div>
      {role === 'SUPER_ADMIN' && <button type="button" onClick={() => void toggle()} disabled={busy || saving || !policy} aria-pressed={policy?.enabled ?? false} className="min-h-11 rounded-lg border border-[#253451] px-4 text-sm font-medium text-slate-100 hover:border-cyan-300 disabled:opacity-50">{saving ? 'Saving…' : policy?.enabled ? 'Disable guest checkout' : 'Enable guest checkout'}</button>}
      {role !== 'SUPER_ADMIN' && <span className="text-xs text-slate-500">Read-only · super admin required to change</span>}
    </div>
    {busy && !policy && <p role="status" className="mt-3 text-sm text-slate-400">Loading checkout policy…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-300">{notice}</p>}
  </section>
}

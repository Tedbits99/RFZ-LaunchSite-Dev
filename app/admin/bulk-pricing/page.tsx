'use client'

import { useEffect, useState } from 'react'
import { AdminPage } from '@/components/admin/AdminPage'
import { formatCurrency } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { Wallet, Check, AlertTriangle } from 'lucide-react'

type Pkg = {
  id: string
  name: string
  sku: string
  price_cents: number
  is_active: boolean
  games: { name: string } | null
}

export default function AdminBulkPricingPage() {
  const [packages, setPackages] = useState<Pkg[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [action, setAction] = useState<'set_price' | 'percentage_adjust' | 'activate' | 'deactivate'>('activate')
  const [value, setValue] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState('')

  useEffect(() => {
    if (!supabase) { setError('Database not configured'); setLoading(false); return }
    supabase
      .from('packages')
      .select('id, name, sku, price_cents, is_active, games(name)')
      .order('created_at')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setPackages((data || []) as unknown as Pkg[])
        setLoading(false)
      })
  }, [])

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === packages.length) setSelected(new Set())
    else setSelected(new Set(packages.map((p) => p.id)))
  }

  const apply = async () => {
    setApplying(true)
    setResult('')
    try {
      const res = await fetch('/api/admin/bulk-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageIds: Array.from(selected),
          action,
          value: action === 'set_price' || action === 'percentage_adjust' ? Number(value) : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) setResult(`Error: ${json.error}`)
      else { setResult(`Updated ${json.updated} packages`); setSelected(new Set()); setConfirming(false) }
    } catch {
      setResult('Request failed')
    }
    setApplying(false)
  }

  return (
    <AdminPage title="Bulk Pricing">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Bulk Pricing</h1>
        <p className="mt-1 text-xs text-slate-500">Select multiple packages and apply changes in bulk</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
          <p className="text-sm text-slate-400">Loading packages…</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      ) : (
        <>
          <div className="mb-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Action</label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as typeof action)}
                  className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
                >
                  <option value="activate">Activate</option>
                  <option value="deactivate">Deactivate</option>
                  <option value="set_price">Set Price (cents)</option>
                  <option value="percentage_adjust">Percentage Adjust (%)</option>
                </select>
              </div>
              {(action === 'set_price' || action === 'percentage_adjust') && (
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
                    {action === 'set_price' ? 'Price (cents)' : 'Adjustment %'}
                  </label>
                  <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={action === 'set_price' ? 'e.g. 9900' : 'e.g. -10 or 15'}
                    className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <span className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-400">
                  {selected.size} selected
                </span>
                <button
                  onClick={() => setConfirming(true)}
                  disabled={selected.size === 0}
                  className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Apply
                </button>
              </div>
            </div>
            {result && <p className="mt-3 text-xs text-cyan-300">{result}</p>}
          </div>

          <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-[#1b2a45]">
                  <th className="p-4">
                    <input type="checkbox" onChange={toggleAll} checked={selected.size === packages.length && packages.length > 0} className="accent-cyan-400" />
                  </th>
                  <th className="p-4 font-medium">Package</th>
                  <th className="p-4 font-medium">SKU</th>
                  <th className="p-4 font-medium">Game</th>
                  <th className="p-4 text-right font-medium">Price</th>
                  <th className="p-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className={`border-b border-[#0f1b31] ${selected.has(p.id) ? 'bg-cyan-400/5' : ''}`}>
                    <td className="p-4">
                      <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="accent-cyan-400" />
                    </td>
                    <td className="p-4 font-medium text-slate-200">{p.name}</td>
                    <td className="p-4 font-mono text-cyan-300">{p.sku}</td>
                    <td className="p-4 text-slate-400">{p.games?.name || '—'}</td>
                    <td className="p-4 text-right font-medium">{formatCurrency(p.price_cents)}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${p.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-300" />
              <h2 className="font-display font-semibold">Confirm Bulk Action</h2>
            </div>
            <p className="text-sm text-slate-400">
              You are about to <span className="font-medium text-cyan-300">{action.replace('_', ' ')}</span>
              {value && ` (${value}${action === 'percentage_adjust' ? '%' : ' cents'})`} on{' '}
              <span className="font-medium text-cyan-300">{selected.size}</span> packages.
            </p>
            <p className="mt-2 text-xs text-slate-500">This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="rounded-lg border border-[#22314d] px-4 py-2 text-xs text-slate-300">
                Cancel
              </button>
              <button
                onClick={apply}
                disabled={applying}
                className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {applying ? 'Applying…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  )
}

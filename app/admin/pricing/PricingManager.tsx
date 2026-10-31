'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Save } from 'lucide-react'

type PackageRow = {
  id: string
  name: string
  sku: string
  price_cents: number
  original_price_cents?: number | null
  is_active: boolean
  catalog_status: string
  games: { name: string } | null
}

function pesos(cents: number) {
  return '₱' + (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647 ? cents : null
}

export default function AdminPricingManager() {
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/bulk-pricing', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Catalog pricing could not be loaded.')
      const rows = (result.packages || []) as PackageRow[]
      setPackages(rows)
      setDrafts(Object.fromEntries(rows.map((row) => [row.id, (row.price_cents / 100).toFixed(2)])))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Catalog pricing could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save(row: PackageRow) {
    const price = parseCents(drafts[row.id] || '')
    if (price === null) {
      setError('Enter a positive PHP amount with no more than two decimal places.')
      setNotice('')
      return
    }
    setSavingId(row.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/admin/package-pricing', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, price_cents: price }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Price could not be saved.')
      setNotice('Price saved. The package is now a draft and must pass the existing review and publish checks before checkout can sell it.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Price could not be saved.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section aria-labelledby="pricing-title" className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 id="pricing-title" className="font-display text-2xl font-bold">Catalog pricing</h1>
          <p className="mt-1 text-sm text-slate-400">Retail package prices in PHP. Price edits are audited and move changed packages to draft.</p>
        </div>
        <Link href="/admin/bulk-pricing" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#253451] px-4 text-sm text-cyan-200 hover:border-cyan-300">
          Bulk pricing <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">
        <div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><p>Changing a price does not publish it. Catalog lifecycle and supplier review checks remain mandatory.</p></div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
      {loading ? <p role="status" className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">Loading package prices…</p> : error && packages.length === 0 ? null : packages.length === 0 ? (
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-center text-sm text-slate-400">No packages are available to price.</div>
      ) : (
        <div className="grid gap-3">
          {packages.map((row) => {
            const inputId = 'package-price-' + row.id
            return <form key={row.id} onSubmit={(event) => { event.preventDefault(); void save(row) }} className="grid gap-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-slate-100">{row.name}</h2>
                <p className="mt-1 truncate text-xs text-slate-400">{row.games?.name || 'Unassigned game'} · <span className="font-mono">{row.sku}</span></p>
                <p className="mt-1 text-xs text-slate-500">Current: {pesos(row.price_cents)} · {row.catalog_status}{row.is_active ? ' / visible' : ''}</p>
              </div>
              <label htmlFor={inputId} className="block text-xs text-slate-400">Retail price (PHP)
                <input id={inputId} inputMode="decimal" autoComplete="off" value={drafts[row.id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-[#253451] bg-[#070d1c] px-3 text-sm text-white" aria-label={'Retail price in PHP for ' + row.name} />
              </label>
              <button type="submit" disabled={savingId === row.id || drafts[row.id] === (row.price_cents / 100).toFixed(2)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-45">
                <Save size={14} aria-hidden="true" /> {savingId === row.id ? 'Saving…' : 'Save price'}
              </button>
            </form>
          })}
        </div>
      )}
    </section>
  )
}

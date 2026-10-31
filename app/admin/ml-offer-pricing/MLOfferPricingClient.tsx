'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Archive, Check, Loader2, Package, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { minimumSalePriceCents } from '@/lib/catalogPricing'

type Pkg = {
  id: string
  name: string
  sku: string
  amount: string
  price_cents: number
  original_price_cents: number | null
  bonus: string | null
  is_active: boolean
  catalog_status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  supplier_review_required: boolean
  sort_order: number
  badge: string | null
  supplier_offer_id: string | null
  supplier_category_id: string | null
  supplier_cost_usd: string | null
  markup_percent: string | null
}

type ImportResponse = { success: boolean; created: number; updated: number; deactivated: number; failed: number; failed_offer_ids?: string[]; requires_review: number; error?: string }

function formatPHP(cents: number) {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
}

function toCents(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null
}

export default function MLOfferPricingClient() {
  const [packages, setPackages] = useState<Pkg[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ price: '', sort: '', badge: '', originalPrice: '' })
  const [snapshot, setSnapshot] = useState('')
  const [completeSnapshot, setCompleteSnapshot] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const [fxRate, setFxRate] = useState('')
  const [feeBps, setFeeBps] = useState('')
  const [fixedFeeCents, setFixedFeeCents] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState('')
  const [error, setError] = useState<string | null>(null)

  const fetchPackages = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/sync-offers', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load packages.')
      setPackages(result.data || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load packages.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not load pricing assumptions.')
      setFxRate(String(result.reference_usd_php_rate ?? ''))
      setFeeBps(result.payment_fee_reserve_bps == null ? '' : String(result.payment_fee_reserve_bps))
      setFixedFeeCents(result.payment_fee_fixed_cents == null ? '' : String(result.payment_fee_fixed_cents))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load pricing assumptions.')
    }
  }, [])

  useEffect(() => { void fetchPackages(); void fetchSettings() }, [fetchPackages, fetchSettings])

  async function importSnapshot() {
    setImportBusy(true)
    setImportResult(null)
    setError(null)
    try {
      const parsed = JSON.parse(snapshot) as unknown
      const offers = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'offers' in parsed ? (parsed as { offers: unknown }).offers : null
      if (!Array.isArray(offers)) throw new Error('Snapshot JSON must be an array or an object containing an offers array.')
      const response = await fetch('/api/admin/catalog/import-offers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: 'mobile_legends_philippines', offers, complete_snapshot: completeSnapshot }),
      })
      const result = await response.json()
      if (!response.ok && response.status !== 207) throw new Error(result.error || 'Snapshot import failed.')
      setImportResult(result as ImportResponse)
      await fetchPackages()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Snapshot import failed.')
    } finally {
      setImportBusy(false)
    }
  }

  async function savePricingAssumptions() {
    const rate = Number(fxRate)
    const bps = Number(feeBps)
    const fixed = Number(fixedFeeCents)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000 || !Number.isInteger(bps) || bps < 0 || bps >= 10000 || !Number.isSafeInteger(fixed) || fixed < 0) {
      setError('Enter a valid FX rate, fee reserve from 0–9999 basis points, and non-negative fixed fee cents.')
      return
    }
    setSettingsBusy(true)
    setError(null)
    setSettingsNotice('')
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_usd_php_rate: rate, payment_fee_reserve_bps: bps, payment_fee_fixed_cents: fixed }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not save pricing assumptions.')
      setSettingsNotice(`Saved. ${result.packages_requiring_review} supplier package(s) were moved to draft for explicit review; retail prices were not recalculated.`)
      await fetchPackages()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save pricing assumptions.')
    } finally {
      setSettingsBusy(false)
    }
  }

  function beginEdit(pkg: Pkg) {
    setEditingId(pkg.id)
    setEdit({ price: pkg.price_cents > 0 ? (pkg.price_cents / 100).toFixed(2) : '', sort: String(pkg.sort_order), badge: pkg.badge || '', originalPrice: pkg.original_price_cents ? (pkg.original_price_cents / 100).toFixed(2) : '' })
    setError(null)
  }

  async function savePackage(pkg: Pkg) {
    const priceCents = toCents(edit.price)
    const originalPriceCents = edit.originalPrice.trim() ? toCents(edit.originalPrice) : null
    if (priceCents === null || (edit.originalPrice.trim() && originalPriceCents === null) || (originalPriceCents !== null && originalPriceCents < priceCents)) {
      setError('Selling price must be non-negative and original price cannot be below it.')
      return
    }
    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/catalog/packages/${pkg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_cents: priceCents, original_price_cents: originalPriceCents, sort_order: Number(edit.sort) || 0, badge: edit.badge.trim() || null }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save package.')
      setPackages((current) => current.map((item) => item.id === pkg.id ? result.data as Pkg : item))
      setEditingId(null)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save package.')
    } finally {
      setSavingId(null)
    }
  }

  async function lifecycle(pkg: Pkg, action: 'publish' | 'hide' | 'archive' | 'restore') {
    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/catalog/packages/${pkg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, acknowledge_supplier_review: action === 'publish' && pkg.supplier_review_required }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Could not ${action} package.`)
      setPackages((current) => current.map((item) => item.id === pkg.id ? result.data as Pkg : item))
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Could not ${action} package.`)
    } finally {
      setSavingId(null)
    }
  }

  function minimumPrice(pkg: Pkg) {
    const cost = Number(pkg.supplier_cost_usd || 0)
    const rate = Number(fxRate)
    const bps = Number(feeBps)
    const fixed = Number(fixedFeeCents)
    if (!cost || !Number.isFinite(rate) || !Number.isInteger(bps) || !Number.isInteger(fixed)) return null
    return minimumSalePriceCents(cost, rate, bps, fixed)
  }

  const activeCount = packages.filter((pkg) => pkg.is_active && pkg.catalog_status === 'PUBLISHED').length

  return <div className="min-h-screen bg-[#030718]">
    <div className="mb-6"><h1 className="font-display text-2xl font-bold text-slate-100">Mobile Legends Offer Pricing</h1><p className="mt-1 text-sm text-slate-400">Import a reviewed offer snapshot only. Live supplier synchronization and fulfillment are disabled. Category: <span className="font-mono text-cyan-300">mobile_legends_philippines</span></p></div>

    <section className="mb-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
      <h2 className="text-sm font-semibold text-slate-100">Reviewed offer snapshot</h2>
      <label className="mt-3 block text-xs text-slate-400">Snapshot JSON<textarea value={snapshot} onChange={(event) => setSnapshot(event.target.value)} rows={5} placeholder={'[{"offer_id":"synthetic-offer-1","name":"Synthetic offer","price_usd":"1.25"}]'} className="mt-2 w-full rounded-lg border border-[#253451] bg-[#080f20] p-3 font-mono text-xs text-slate-200" /></label>
      <label className="mt-3 flex items-start gap-2 text-xs text-amber-300"><input type="checkbox" checked={completeSnapshot} onChange={(event) => setCompleteSnapshot(event.target.checked)} />This is a complete category snapshot; absent offers may be moved to draft only if every import succeeds.</label>
      <button type="button" onClick={() => void importSnapshot()} disabled={importBusy || !snapshot.trim()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Import as draft offers</button>
      {importResult && <p role="status" className="mt-3 text-xs text-emerald-300">{importResult.created} created, {importResult.updated} refreshed, {importResult.deactivated} removed offers drafted, {importResult.failed} failed; {importResult.requires_review} require review. New offers remain draft/inactive.</p>}
      {importResult?.failed_offer_ids?.length ? <p className="mt-1 break-all font-mono text-[11px] text-amber-300">Failed offer IDs: {importResult.failed_offer_ids.join(', ')}</p> : null}
    </section>

    <section className="mb-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
      <h2 className="text-sm font-semibold text-slate-100">Explicit pricing assumptions</h2>
      <p className="mt-1 text-xs text-slate-400">Changing FX or fee assumptions never rewrites retail prices; linked packages move to draft and require review.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-400">Reference FX: PHP per USD<input type="number" min="0.0001" step="0.0001" value={fxRate} onChange={(event) => setFxRate(event.target.value)} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
        <label className="text-xs text-slate-400">Payment fee reserve (basis points)<input type="number" min="0" max="9999" step="1" value={feeBps} onChange={(event) => setFeeBps(event.target.value)} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
        <label className="text-xs text-slate-400">Fixed payment fee (cents)<input type="number" min="0" step="1" value={fixedFeeCents} onChange={(event) => setFixedFeeCents(event.target.value)} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-sm text-slate-100" /></label>
      </div>
      <button type="button" onClick={() => void savePricingAssumptions()} disabled={settingsBusy || !feeBps.trim() || !fixedFeeCents.trim()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">{settingsBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save assumptions &amp; flag offers for review</button>
      {settingsNotice && <p role="status" className="mt-2 text-xs text-amber-300">{settingsNotice}</p>}
    </section>

    {error && <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-300"><AlertTriangle size={15} />{error}</div>}
    <div className="mb-4 flex flex-wrap gap-3 text-xs"><div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5"><span className="text-slate-500">Total packages</span><p className="text-lg font-bold text-slate-200">{packages.length}</p></div><div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5"><span className="text-slate-500">Published and saleable</span><p className="text-lg font-bold text-emerald-400">{activeCount}</p></div></div>

    {loading ? <div className="flex flex-col items-center py-20"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /><p className="mt-3 text-sm text-slate-500">Loading packages…</p></div> : packages.length === 0 ? <div className="flex flex-col items-center py-20"><Package className="h-12 w-12 text-slate-600" /><p className="mt-3 text-sm text-slate-500">No imported supplier offers yet.</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {packages.map((pkg) => {
        const min = minimumPrice(pkg)
        const editing = editingId === pkg.id
        const saving = savingId === pkg.id
        return <article key={pkg.id} className="rounded-xl border border-[#1b2a45] bg-[#0a1124] p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-medium text-slate-200">{pkg.name}</h3><p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{pkg.supplier_offer_id}</p></div><span className={`rounded-full px-2 py-0.5 text-[10px] ${pkg.catalog_status === 'PUBLISHED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>{pkg.catalog_status}</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><p className="text-slate-500">Cost (USD)</p><p className="text-amber-300">{pkg.supplier_cost_usd ?? '—'}</p></div><div><p className="text-slate-500">Retail price</p><p className="text-cyan-300">{formatPHP(pkg.price_cents)}</p></div></div>
          {min !== null && <p className={`mt-2 text-[11px] ${pkg.price_cents < min ? 'text-rose-300' : 'text-slate-500'}`}>Minimum with current FX/fee assumptions: {formatPHP(min)}{pkg.price_cents < min ? ' · below safe floor' : ''}</p>}
          {pkg.supplier_review_required && <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Supplier cost / fee review required.</p>}
          {editing ? <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-400">Retail PHP<input type="number" min="0" step="0.01" value={edit.price} onChange={(event) => setEdit({ ...edit, price: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-slate-100" /></label><label className="text-[11px] text-slate-400">Original PHP<input type="number" min="0" step="0.01" value={edit.originalPrice} onChange={(event) => setEdit({ ...edit, originalPrice: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-slate-100" /></label><label className="text-[11px] text-slate-400">Sort order<input type="number" min="0" step="1" value={edit.sort} onChange={(event) => setEdit({ ...edit, sort: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-slate-100" /></label><label className="text-[11px] text-slate-400">Badge<input value={edit.badge} onChange={(event) => setEdit({ ...edit, badge: event.target.value })} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] p-2 text-slate-100" /></label><div className="col-span-2 flex gap-2"><button type="button" disabled={saving} onClick={() => void savePackage(pkg)} className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-emerald-500/30 px-2 py-2 text-xs text-emerald-300"><Save size={13} /> Save</button><button type="button" onClick={() => setEditingId(null)} className="rounded border border-[#253451] px-3 py-2 text-xs text-slate-400">Cancel</button></div></div> : <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => beginEdit(pkg)} className="rounded border border-[#253451] px-2.5 py-1.5 text-xs text-slate-300">Edit</button>{pkg.catalog_status === 'ARCHIVED' ? <button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'restore')} className="inline-flex items-center gap-1 rounded border border-amber-400/30 px-2.5 py-1.5 text-xs text-amber-300"><RotateCcw size={12} />Restore</button> : <>{pkg.is_active ? <button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'hide')} className="rounded border border-slate-400/30 px-2.5 py-1.5 text-xs text-slate-300">Hide</button> : <button type="button" disabled={saving || pkg.price_cents <= 0} onClick={() => void lifecycle(pkg, 'publish')} className="rounded border border-emerald-400/30 px-2.5 py-1.5 text-xs text-emerald-300 disabled:opacity-40">Publish</button>}<button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'archive')} className="inline-flex items-center gap-1 rounded border border-rose-400/30 px-2.5 py-1.5 text-xs text-rose-300"><Archive size={12} />Archive</button></>}</div>}
          {saving && <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><Loader2 size={12} className="animate-spin" />Saving…</p>}
        </article>
      })}
    </div>}
  </div>
}

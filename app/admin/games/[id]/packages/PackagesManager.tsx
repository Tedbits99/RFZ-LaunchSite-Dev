'use client'

import { useState } from 'react'
import { Archive, Check, Loader2, Package, Plus, Save, RotateCcw } from 'lucide-react'

type PackageRecord = {
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
  image_url: string | null
  supplier_offer_id: string | null
  supplier_category_id: string | null
  supplier_cost_usd: string | null
}

type PackageDraft = { name: string; sku: string; amount: string; price: string; originalPrice: string; bonus: string; sort: string; badge: string; imageUrl: string }
const blankDraft = (): PackageDraft => ({ name: '', sku: '', amount: '', price: '', originalPrice: '', bonus: '', sort: '100', badge: '', imageUrl: '' })

export default function PackagesManager({ packages: initialPackages, gameId, isMobileLegends }: { packages: PackageRecord[]; gameId: string; isMobileLegends: boolean }) {
  const [packages, setPackages] = useState(initialPackages)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PackageDraft>(blankDraft())
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  function formatPHP(cents: number) {
    return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  }

  function beginEdit(pkg: PackageRecord) {
    setEditingId(pkg.id)
    setDraft({
      name: pkg.name,
      sku: pkg.sku,
      amount: pkg.amount,
      price: pkg.price_cents > 0 ? (pkg.price_cents / 100).toFixed(2) : '',
      originalPrice: pkg.original_price_cents ? (pkg.original_price_cents / 100).toFixed(2) : '',
      bonus: pkg.bonus || '',
      sort: String(pkg.sort_order),
      badge: pkg.badge || '',
      imageUrl: pkg.image_url || '',
    })
    setError(null)
  }

  function cents(value: string) {
    const amount = value.trim() ? Number(value) : 0
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null
  }

  function replaceRow(row: PackageRecord) {
    setPackages((current) => {
      const exists = current.some((item) => item.id === row.id)
      return (exists ? current.map((item) => item.id === row.id ? row : item) : [...current, row]).sort((a, b) => a.sort_order - b.sort_order)
    })
  }

  async function createPackage() {
    const priceCents = cents(draft.price)
    const originalPriceCents = draft.originalPrice.trim() ? cents(draft.originalPrice) : null
    if (!draft.name.trim() || !draft.sku.trim() || priceCents === null || (draft.originalPrice.trim() && originalPriceCents === null) || (originalPriceCents !== null && originalPriceCents < priceCents)) {
      setError('Enter a name, unique SKU, valid non-negative price, and an original price no lower than the selling price.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/catalog/packages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: gameId, name: draft.name.trim(), sku: draft.sku.trim(), amount: draft.amount.trim() || draft.name.trim(),
          price_cents: priceCents, original_price_cents: originalPriceCents, bonus: draft.bonus.trim() || null,
          sort_order: Number(draft.sort) || 100, badge: draft.badge.trim() || null, image_url: draft.imageUrl.trim() || null,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not create package.')
      replaceRow(result.data as PackageRecord)
      setDraft(blankDraft())
      setShowCreate(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not create package.')
    } finally {
      setCreating(false)
    }
  }

  async function savePackage(pkg: PackageRecord) {
    const priceCents = cents(draft.price)
    const originalPriceCents = draft.originalPrice.trim() ? cents(draft.originalPrice) : null
    if (!draft.name.trim() || !draft.amount.trim() || priceCents === null || (draft.originalPrice.trim() && originalPriceCents === null) || (originalPriceCents !== null && originalPriceCents < priceCents)) {
      setError('Enter a valid name, amount, selling price, and original price.')
      return
    }
    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/catalog/packages/${pkg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(), amount: draft.amount.trim(), price_cents: priceCents,
          original_price_cents: originalPriceCents, bonus: draft.bonus.trim() || null,
          sort_order: Number(draft.sort) || pkg.sort_order, badge: draft.badge.trim() || null, image_url: draft.imageUrl.trim() || null,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Could not save package.')
      replaceRow(result.data as PackageRecord)
      setEditingId(null)
      setSavedId(pkg.id)
      window.setTimeout(() => setSavedId((current) => current === pkg.id ? null : current), 1800)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save package.')
    } finally {
      setSavingId(null)
    }
  }

  async function lifecycle(pkg: PackageRecord, action: 'publish' | 'hide' | 'archive' | 'restore') {
    if (action === 'archive' && !window.confirm(`Archive ${pkg.name}? Existing order references will be retained.`)) return
    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/catalog/packages/${pkg.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, acknowledge_supplier_review: pkg.supplier_review_required && action === 'publish' }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || `Could not ${action} package.`)
      replaceRow(result.data as PackageRecord)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Could not ${action} package.`)
    } finally {
      setSavingId(null)
    }
  }

  const activeCount = packages.filter((pkg) => pkg.catalog_status === 'PUBLISHED' && pkg.is_active && pkg.price_cents > 0).length

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5"><span className="text-slate-500">Packages</span><p className="text-lg font-bold text-slate-200">{packages.length}</p></div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5"><span className="text-slate-500">Published and saleable</span><p className="text-lg font-bold text-emerald-400">{activeCount}</p></div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5"><span className="text-slate-500">Awaiting price/review</span><p className="text-lg font-bold text-amber-300">{packages.filter((pkg) => pkg.price_cents <= 0 || pkg.supplier_review_required).length}</p></div>
      </div>
      <button type="button" onClick={() => { setShowCreate((shown) => !shown); setDraft(blankDraft()); setError(null) }} className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-200"><Plus size={14} /> Add package</button>
    </div>

    {showCreate && <section aria-label="Create package" className="mb-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Create draft package</h2>
      <PackageFields draft={draft} setDraft={setDraft} />
      <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded border border-[#253451] px-3 py-2 text-xs text-slate-300">Cancel</button><button type="button" disabled={creating} onClick={() => void createPackage()} className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">{creating ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Create draft</button></div>
    </section>}

    {error && <div role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">{error}</div>}

    {packages.length === 0 ? <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16 text-center text-sm text-slate-500">No packages yet. Add a draft package or import a reviewed supplier snapshot.</div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {packages.map((pkg) => {
        const editing = editingId === pkg.id
        const saving = savingId === pkg.id
        const supplierPackage = Boolean(pkg.supplier_offer_id || pkg.supplier_category_id)
        return <article key={pkg.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <div className="flex items-center justify-between"><Package className="text-cyan-300" size={18} /><span className={`rounded-full px-2 py-0.5 text-[10px] ${pkg.catalog_status === 'PUBLISHED' ? 'bg-emerald-500/20 text-emerald-300' : pkg.catalog_status === 'ARCHIVED' ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-500/20 text-slate-400'}`}>{pkg.catalog_status}</span></div>
          <h3 className="mt-3 font-semibold text-slate-100">{pkg.name}</h3><p className="text-xs text-slate-500">{pkg.sku} · {pkg.amount}</p>
          {pkg.bonus && <p className="mt-1 text-[11px] text-emerald-300">{pkg.bonus}</p>}
          {supplierPackage && <div className="mt-3 space-y-1 rounded-lg border border-[#1b2a45] bg-[#080f20] p-3 text-[11px]"><p className="text-slate-500">Supplier offer</p><p className="break-all font-mono text-cyan-300">{pkg.supplier_offer_id || 'identity incomplete'}</p><p className="pt-1 text-slate-500">Supplier cost</p><p className="text-amber-300">${pkg.supplier_cost_usd || '—'}</p>{pkg.supplier_review_required && <p className="text-amber-300">Cost or pricing assumptions need review.</p>}</div>}
          {editing ? <div className="mt-3 space-y-2"><PackageFields draft={draft} setDraft={setDraft} edit /><div className="flex gap-2"><button type="button" onClick={() => void savePackage(pkg)} disabled={saving} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50"><Save size={13} /> Save draft changes</button><button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-400">Cancel</button></div></div> : <>
            <div className="mt-3 flex items-center justify-between gap-3"><div><span className="text-lg font-bold text-cyan-300">{formatPHP(pkg.price_cents)}</span>{pkg.price_cents <= 0 && <p className="text-[11px] text-amber-300">Awaiting selling price</p>}</div><button type="button" onClick={() => beginEdit(pkg)} className="rounded-lg border border-[#22314d] px-3 py-1.5 text-xs text-cyan-300">Edit</button></div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pkg.catalog_status === 'ARCHIVED' ? <button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'restore')} className="inline-flex items-center gap-1 rounded border border-amber-400/30 px-2 py-1 text-[11px] text-amber-300"><RotateCcw size={12} /> Restore</button> : <>
                {pkg.catalog_status === 'PUBLISHED' && pkg.is_active ? <button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'hide')} className="rounded border border-slate-400/30 px-2 py-1 text-[11px] text-slate-300">Hide</button> : <button type="button" disabled={saving || pkg.price_cents <= 0} onClick={() => void lifecycle(pkg, 'publish')} className="rounded border border-emerald-400/30 px-2 py-1 text-[11px] text-emerald-300 disabled:opacity-40">Publish</button>}
                <button type="button" disabled={saving} onClick={() => void lifecycle(pkg, 'archive')} className="inline-flex items-center gap-1 rounded border border-rose-400/30 px-2 py-1 text-[11px] text-rose-300"><Archive size={12} /> Archive</button>
              </>}
              {savedId === pkg.id && <span role="status" className="inline-flex items-center gap-1 text-[11px] text-emerald-300"><Check size={12} /> Saved</span>}
            </div>
          </>}
          {supplierPackage && <p className="mt-3 text-[10px] text-slate-500">Supplier fulfillment remains independently release-locked.</p>}
          {isMobileLegends && !supplierPackage && <p className="mt-2 text-[10px] text-slate-500">Manual package; no supplier offer is configured.</p>}
        </article>
      })}
    </div>}
  </div>
}

function PackageFields({ draft, setDraft, edit = false }: { draft: PackageDraft; setDraft: (value: PackageDraft) => void; edit?: boolean }) {
  const inputClass = 'mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400'
  return <div className="grid gap-2 sm:grid-cols-2">
    <label className="text-[11px] text-slate-500">Name<input required maxLength={180} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></label>
    {!edit && <label className="text-[11px] text-slate-500">SKU<input required maxLength={120} value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} className={inputClass} /></label>}
    <label className="text-[11px] text-slate-500">Amount / description<input required value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500">Selling price (PHP)<input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500">Original price (PHP, optional)<input type="number" min="0" step="0.01" value={draft.originalPrice} onChange={(event) => setDraft({ ...draft, originalPrice: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500">Bonus<input value={draft.bonus} onChange={(event) => setDraft({ ...draft, bonus: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500">Sort order<input type="number" value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500">Badge<input value={draft.badge} onChange={(event) => setDraft({ ...draft, badge: event.target.value })} className={inputClass} /></label>
    <label className="text-[11px] text-slate-500 sm:col-span-2">Image URL (HTTPS)<input type="url" pattern="https://.*" value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} className={inputClass} /></label>
  </div>
}

'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Package, Save, Sparkles } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser'

type PackageRecord = {
  id: string
  name: string
  sku: string
  amount: string
  price_cents: number
  original_price_cents: number | null
  bonus: string | null
  is_active: boolean
  sort_order: number
  badge: string | null
  image_url: string | null
  supplier_offer_id: string | null
  supplier_category_id: string | null
  supplier_cost_usd: string | null
}

type PackagesManagerProps = {
  packages: PackageRecord[]
  gameId: string
  isMobileLegends: boolean
}

export default function PackagesManager({ packages: initialPackages, gameId, isMobileLegends }: PackagesManagerProps) {
  const [packages, setPackages] = useState(initialPackages)
  const [loading, setLoading] = useState(isMobileLegends)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ price: string; sort: string; badge: string; imageUrl: string }>({ price: '', sort: '', badge: '', imageUrl: '' })
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isMobileLegends) return
    let cancelled = false
    const loadPackages = async () => {
      const supabase = getSupabaseBrowserClient()
      if (!supabase) {
        setError('Admin database session is unavailable.')
        setLoading(false)
        return
      }
      const { data, error: loadError } = await supabase
        .from('packages')
        .select('id, name, sku, amount, price_cents, original_price_cents, bonus, is_active, sort_order, badge, image_url, supplier_offer_id, supplier_category_id, supplier_cost_usd')
        .eq('game_id', gameId)
        .eq('supplier_category_id', 'mobile_legends_philippines')
        .not('supplier_offer_id', 'is', null)
        .order('sort_order')
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
      } else {
        setPackages((data || []) as PackageRecord[])
      }
      setLoading(false)
    }
    loadPackages()
    return () => { cancelled = true }
  }, [gameId, isMobileLegends])

  function formatPHP(cents: number): string {
    return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  }

  function beginEdit(pkg: PackageRecord) {
    setEditingId(pkg.id)
    setDraft({
      price: pkg.price_cents > 0 ? (pkg.price_cents / 100).toFixed(2) : '',
      sort: String(pkg.sort_order),
      badge: pkg.badge || '',
      imageUrl: pkg.image_url || '',
    })
    setError(null)
  }

  async function savePackage(pkg: PackageRecord) {
    const price = draft.price === '' ? 0 : Number(draft.price)
    const sort = draft.sort === '' ? pkg.sort_order : Number(draft.sort)
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(sort)) {
      setError('Enter a valid selling price and sort order.')
      return
    }

    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch('/api/admin/package-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pkg.id,
          price_cents: Math.round(price * 100),
          sort_order: Math.round(sort),
          badge: draft.badge.trim() || null,
          image_url: draft.imageUrl.trim() || null,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not save package.')
      if (!result.data || typeof result.data.price_cents !== 'number') throw new Error('The server did not return the updated package.')

      setPackages((current) => current.map((item) => item.id === pkg.id ? {
        ...item,
        price_cents: result.data.price_cents,
        sort_order: result.data.sort_order,
        badge: result.data.badge,
        image_url: result.data.image_url,
      } : item).sort((a, b) => a.sort_order - b.sort_order))
      setEditingId(null)
      setSavedId(pkg.id)
      window.setTimeout(() => setSavedId((current) => current === pkg.id ? null : current), 1800)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save package.')
    } finally {
      setSavingId(null)
    }
  }

  async function togglePackage(pkg: PackageRecord) {
    setSavingId(pkg.id)
    setError(null)
    try {
      const response = await fetch('/api/admin/package-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.id, is_active: !pkg.is_active }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.success) throw new Error(result.error || 'Could not update package status.')
      if (!result.data || typeof result.data.is_active !== 'boolean') throw new Error('The server did not return the updated package status.')
      setPackages((current) => current.map((item) => item.id === pkg.id ? { ...item, is_active: result.data.is_active } : item))
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update package status.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3 text-xs">
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-slate-500">Current offers</span>
          <p className="text-lg font-bold text-slate-200">{packages.length}</p>
        </div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-slate-500">Active for customers</span>
          <p className="text-lg font-bold text-emerald-400">{packages.filter((pkg) => pkg.is_active && pkg.price_cents > 0).length}</p>
        </div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-slate-500">Awaiting price</span>
          <p className="text-lg font-bold text-amber-300">{packages.filter((pkg) => pkg.price_cents <= 0).length}</p>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-300">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading current offers...</div>
      ) : packages.length === 0 ? (
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16 text-center text-sm text-slate-500">No current packages are available.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => {
            const editing = editingId === pkg.id
            const saving = savingId === pkg.id
            const supplierPackage = isMobileLegends && pkg.supplier_category_id === 'mobile_legends_philippines'
            return (
              <div key={pkg.id} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
                <div className="flex items-center justify-between">
                  <Package className="text-cyan-300" size={18} />
                  <button
                    type="button"
                    onClick={() => togglePackage(pkg)}
                    disabled={saving}
                    className={`rounded-full px-2 py-0.5 text-[10px] transition ${pkg.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {pkg.is_active ? 'ACTIVE' : 'DISABLED'}
                  </button>
                </div>
                <h3 className="font-display mt-3 font-semibold text-slate-100">{pkg.name}</h3>
                <p className="text-xs text-slate-500">{pkg.sku} · {pkg.amount}</p>
                {pkg.bonus && <p className="mt-1 text-[11px] text-emerald-300">{pkg.bonus}</p>}

                {supplierPackage && (
                  <div className="mt-3 space-y-1 rounded-lg border border-[#1b2a45] bg-[#080f20] p-3 text-[11px]">
                    <p className="text-slate-500">FazerCards offer</p>
                    <p className="break-all font-mono text-cyan-300">{pkg.supplier_offer_id}</p>
                    <p className="pt-1 text-slate-500">Supplier cost</p>
                    <p className="text-amber-300">${pkg.supplier_cost_usd || '0.00'}</p>
                  </div>
                )}

                {editing ? (
                  <div className="mt-3 space-y-2">
                    <label className="block text-[11px] text-slate-500">Selling price (PHP)
                      <input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[11px] text-slate-500">Sort
                        <input type="number" value={draft.sort} onChange={(event) => setDraft((current) => ({ ...current, sort: event.target.value }))} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400" />
                      </label>
                      <label className="block text-[11px] text-slate-500">Badge
                        <input value={draft.badge} onChange={(event) => setDraft((current) => ({ ...current, badge: event.target.value }))} className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400" />
                      </label>
                    </div>
                    <label className="block text-[11px] text-slate-500">Image URL (HTTPS)
                      <input value={draft.imageUrl} onChange={(event) => setDraft((current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://res.cloudinary.com/..." className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400" />
                    </label>
                    {draft.imageUrl.startsWith('https://') && (
                      <div className="flex justify-center rounded-lg border border-[#253451] bg-[#080f20] p-2">
                                                <img src={draft.imageUrl} alt="Package preview" className="h-16 w-16 object-contain" />
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => savePackage(pkg)} disabled={saving} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"><Save size={13} /> Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <span className="font-display text-lg font-bold text-cyan-300">{formatPHP(pkg.price_cents)}</span>
                      {pkg.price_cents <= 0 && <p className="text-[11px] text-amber-300">Awaiting selling price</p>}
                    </div>
                    <button type="button" onClick={() => beginEdit(pkg)} className="rounded-lg border border-[#22314d] px-3 py-1.5 text-xs text-cyan-300 hover:border-cyan-400/50 hover:bg-cyan-400/5">Edit</button>
                  </div>
                )}

                {savedId === pkg.id && <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300"><Check size={12} /> Saved</p>}
                {supplierPackage && <p className="mt-3 inline-flex items-center gap-1 text-[10px] text-slate-500"><Sparkles size={11} /> Supplier fields are admin-only</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

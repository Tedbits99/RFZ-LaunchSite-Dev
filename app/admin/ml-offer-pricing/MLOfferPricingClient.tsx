'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Loader2, RefreshCw, AlertTriangle, Check, X,
  Package, ToggleLeft, ToggleRight, Save, TrendingUp,
} from 'lucide-react';

interface Pkg {
  id: string;
  name: string;
  sku: string;
  amount: string;
  price_cents: number;
  original_price_cents: number | null;
  bonus: string | null;
  is_active: boolean;
  sort_order: number;
  badge: string | null;
  supplier_offer_id: string | null;
  supplier_category_id: string | null;
  supplier_cost_usd: string | null;
  markup_percent: string | null;
}

interface SyncResult {
  success: boolean;
  category_id: string;
  offers_found: number;
  packages_created: number;
  packages_updated: number;
  packages_failed?: number;
  failures?: string[];
  mappings_created: number;
  packages_deactivated?: number;
  skipped?: number;
  warning?: string;
  error?: string;
}

const FALLBACK_FX_RATE = 56;

function formatPHP(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function phpToCents(pesos: string): number {
  const parsed = parseFloat(pesos);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function centsToPHPString(cents: number): string {
  if (cents <= 0) return '';
  return (cents / 100).toFixed(2);
}

export default function MLOfferPricingClient() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ price_php: string; sort_order: string; badge: string; original_price_php: string; markup_percent: string }>({
    price_php: '', sort_order: '', badge: '', original_price_php: '', markup_percent: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [fxRate, setFxRate] = useState<number>(FALLBACK_FX_RATE);
  const [fxRateInput, setFxRateInput] = useState<string>('');
  const [fxSaving, setFxSaving] = useState(false);
  const [fxSaved, setFxSaved] = useState(false);
  const [recalculatedCount, setRecalculatedCount] = useState<number | null>(null);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [liveRateLoading, setLiveRateLoading] = useState(false);
  const [liveRateError, setLiveRateError] = useState<string | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sync-offers');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPackages(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load packages');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFxRate = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const json = await res.json();
      if (json.error) return;
      const rate = Number(json.reference_usd_php_rate);
      if (rate > 0) setFxRate(rate);
    } catch {
      // keep default
    }
  }, []);

  const fetchLiveRate = useCallback(async () => {
    setLiveRateLoading(true);
    setLiveRateError(null);
    try {
      const res = await fetch('/api/admin/fx-rate');
      const json = await res.json();
      if (json.live_rate != null) {
        setLiveRate(Number(json.live_rate));
      } else {
        setLiveRateError(json.error || 'Could not fetch live rate');
      }
    } catch {
      setLiveRateError('Could not reach the live FX API');
    } finally {
      setLiveRateLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
    fetchFxRate();
    fetchLiveRate();
  }, [fetchPackages, fetchFxRate, fetchLiveRate]);

  function effectivePriceCents(pkg: Pkg, rate: number): number {
    if (pkg.markup_percent != null && pkg.supplier_cost_usd) {
      const costUsd = parseFloat(pkg.supplier_cost_usd);
      const markup = parseFloat(pkg.markup_percent);
      if (costUsd > 0 && !Number.isNaN(markup)) {
        const costPHP = costUsd * rate;
        const sellingPHP = costPHP * (1 + markup / 100);
        return Math.round(sellingPHP * 100);
      }
    }
    return pkg.price_cents;
  }

  function costPHPCents(pkg: Pkg, rate: number): number | null {
    if (!pkg.supplier_cost_usd) return null;
    const costUsd = parseFloat(pkg.supplier_cost_usd);
    if (costUsd <= 0) return null;
    return Math.round(costUsd * rate * 100);
  }

  function marginCents(pkg: Pkg, rate: number): number | null {
    const cost = costPHPCents(pkg, rate);
    if (cost == null) return null;
    return effectivePriceCents(pkg, rate) - cost;
  }

  function currentMarkupPercent(pkg: Pkg): number | null {
    if (pkg.markup_percent != null) return parseFloat(pkg.markup_percent);
    const cost = costPHPCents(pkg, fxRate);
    if (cost == null || cost <= 0) return null;
    const price = effectivePriceCents(pkg, fxRate);
    if (price <= 0) return null;
    return Math.round(((price / cost) - 1) * 10000) / 100;
  }

  async function handleSaveFxRate() {
    const rate = parseFloat(fxRateInput);
    if (!rate || rate <= 0 || rate > 1000) return;
    setFxSaving(true);
    setRecalculatedCount(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_usd_php_rate: rate }),
      });
      const json = await res.json();
      if (json.success) {
        setFxRate(Number(json.reference_usd_php_rate));
        setFxRateInput('');
        setFxSaved(true);
        if (typeof json.recalculated === 'number') {
          setRecalculatedCount(json.recalculated);
        }
        setTimeout(() => setFxSaved(false), 2000);
        await fetchPackages();
      } else {
        setError(json.error || 'Could not save the FX rate');
      }
    } catch {
      setError('Could not reach the server to save the FX rate');
    } finally {
      setFxSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/sync-offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: 'mobile_legends_philippines' }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setSyncResult(json);
      await fetchPackages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleActive(pkg: Pkg) {
    try {
      await fetch('/api/admin/package-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pkg.id, is_active: !pkg.is_active }),
      });
      await fetchPackages();
    } catch {
      // silent
    }
  }

  function startEdit(pkg: Pkg) {
    setEditingId(pkg.id);
    const effPrice = effectivePriceCents(pkg, fxRate);
    const markup = currentMarkupPercent(pkg);
    setEditForm({
      price_php: centsToPHPString(effPrice),
      sort_order: String(pkg.sort_order || 0),
      badge: pkg.badge || '',
      original_price_php: pkg.original_price_cents ? centsToPHPString(pkg.original_price_cents) : '',
      markup_percent: markup != null ? String(markup) : '',
    });
  }

  async function handleSave(pkg: Pkg) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { id: pkg.id };
      if (editForm.price_php !== '') body.price_cents = phpToCents(editForm.price_php);
      if (editForm.sort_order !== '') body.sort_order = parseInt(editForm.sort_order);
      body.badge = editForm.badge || null;
      if (editForm.original_price_php !== '') body.original_price_cents = phpToCents(editForm.original_price_php);
      if (editForm.markup_percent !== '') {
        body.markup_percent = parseFloat(editForm.markup_percent);
      }

      const res = await fetch('/api/admin/package-pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Could not save the package');
        return;
      }
      setEditingId(null);
      setSavedIds((prev) => new Set(prev).add(pkg.id));
      setTimeout(() => {
        setSavedIds((prev) => {
          const next = new Set(prev);
          next.delete(pkg.id);
          return next;
        });
      }, 2000);
      await fetchPackages();
    } catch {
      setError('Could not reach the server to save the package');
    } finally {
      setSaving(false);
    }
  }

  const previewRate = useMemo(() => {
    const parsed = parseFloat(fxRateInput);
    return parsed > 0 ? parsed : fxRate;
  }, [fxRateInput, fxRate]);

  const activeCount = packages.filter((p) => p.is_active).length;
  const linkedCount = packages.filter((p) => p.supplier_offer_id).length;

  return (
    <div className="min-h-screen bg-[#030718]">
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-100">
            Mobile Legends Offer Pricing
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            FazerCards Philippines offers with admin-configured selling prices.
            Category: <span className="font-mono text-cyan-300">mobile_legends_philippines</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync FazerCards Offers
        </button>
      </div>

      {/* Stats */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-xs text-slate-500">Total Packages</span>
          <p className="text-lg font-bold text-slate-200">{packages.length}</p>
        </div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-xs text-slate-500">Linked to FazerCards</span>
          <p className="text-lg font-bold text-cyan-300">{linkedCount}</p>
        </div>
        <div className="rounded-lg border border-[#1b2a45] bg-[#0b1225] px-4 py-2.5">
          <span className="text-xs text-slate-500">Active for Customers</span>
          <p className="text-lg font-bold text-emerald-400">{activeCount}</p>
        </div>
      </div>

      {/* Sync result */}
      {syncResult && (
        <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <Check className="h-4 w-4" />
            <span className="text-sm font-medium">
              Fetched {syncResult.offers_found} offers — {syncResult.packages_created} added, {syncResult.packages_updated} updated,
              {syncResult.packages_deactivated ? ` ${syncResult.packages_deactivated} deactivated,` : ''}
              {syncResult.packages_failed ? ` ${syncResult.packages_failed} failed,` : ''}
              {' '}{syncResult.mappings_created} mappings created
            </span>
          </div>
          {syncResult.warning && (
            <p className="mt-2 text-xs text-amber-300">{syncResult.warning}</p>
          )}
          {syncResult.failures && syncResult.failures.length > 0 && (
            <div className="mt-2 space-y-1">
              {syncResult.failures.slice(0, 10).map((failure) => (
                <p key={failure} className="font-mono text-[11px] text-rose-400">{failure}</p>
              ))}
              {syncResult.failures.length > 10 && (
                <p className="text-[11px] text-slate-500">…and {syncResult.failures.length - 10} more</p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-auto text-xs text-slate-500 hover:text-slate-300">Dismiss</button>
          </div>
        </div>
      )}

      {/* Warning about inactive */}
      <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <p className="text-xs leading-relaxed text-amber-300/70">
          Newly synced packages are <span className="font-medium text-amber-300">inactive by default</span>.
          Set a selling price (in PHP) and activate each package individually before customers can see it.
          Supplier cost (USD) is for admin only and never shown to customers.
        </p>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex flex-col items-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          <p className="mt-3 text-sm text-slate-500">Loading packages…</p>
        </div>
      ) : packages.length === 0 ? (
        <div className="flex flex-col items-center py-20">
          <Package className="h-12 w-12 text-slate-600" />
          <p className="mt-3 text-sm text-slate-500">No packages yet. Click &quot;Sync FazerCards Offers&quot; to fetch.</p>
        </div>
      ) : (
        <>
          {/* Table layout: laptop and up */}
          <div className="hidden rounded-xl border border-[#1b2a45] md:block">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[15%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#1b2a45] bg-[#0b1225] text-slate-400">
                  <th className="px-3 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Supplier Offer ID</th>
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Cost (USD)</th>
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Markup %</th>
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Price (PHP)</th>
                  <th className="px-3 py-3 font-medium whitespace-nowrap">Margin</th>
                  <th className="px-3 py-3 font-medium">Badge</th>
                  <th className="px-3 py-3 font-medium">Sort</th>
                  <th className="px-3 py-3 font-medium">Active</th>
                  <th className="px-3 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2a45]">
                {packages.map((pkg) => {
                  const isEditing = editingId === pkg.id;
                  const isSaved = savedIds.has(pkg.id);
                  const margin = marginCents(pkg, previewRate);
                  const effPrice = effectivePriceCents(pkg, previewRate);

                  return (
                    <tr key={pkg.id} className="bg-[#0a1124] transition hover:bg-[#0e1530]">
                      <td className="px-3 py-3 text-slate-200">
                        <span className="line-clamp-2 break-words">{pkg.name}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="block max-w-full truncate font-mono text-xs text-slate-500" title={pkg.supplier_offer_id || ''}>
                          {pkg.supplier_offer_id || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-amber-400">
                        {pkg.supplier_cost_usd ? `${pkg.supplier_cost_usd}` : '—'}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.markup_percent}
                            onChange={(e) => {
                              const markup = parseFloat(e.target.value);
                              setEditForm((p) => ({ ...p, markup_percent: e.target.value }));
                              if (pkg.supplier_cost_usd && !Number.isNaN(markup)) {
                                const costUsd = parseFloat(pkg.supplier_cost_usd);
                                if (costUsd > 0) {
                                  const costPHP = costUsd * fxRate;
                                  const sellingPHP = costPHP * (1 + markup / 100);
                                  setEditForm((p) => ({ ...p, price_php: sellingPHP.toFixed(2) }));
                                }
                              }
                            }}
                            placeholder="e.g. 15"
                            className="w-full max-w-20 rounded border border-[#253451] bg-[#080f20] px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        ) : (
                          <span className={pkg.markup_percent != null ? 'text-cyan-300' : 'text-slate-600'}>
                            {pkg.markup_percent != null ? `${parseFloat(pkg.markup_percent).toFixed(2)}%` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.price_php}
                            onChange={(e) => {
                              setEditForm((p) => ({ ...p, price_php: e.target.value }));
                              if (pkg.supplier_cost_usd) {
                                const costUsd = parseFloat(pkg.supplier_cost_usd);
                                const priceCents = phpToCents(e.target.value);
                                if (costUsd > 0 && priceCents > 0) {
                                  const costPHP = costUsd * fxRate;
                                  const sellingPHP = priceCents / 100;
                                  const computedMarkup = ((sellingPHP / costPHP) - 1) * 100;
                                  setEditForm((p) => ({ ...p, markup_percent: String(Math.round(computedMarkup * 100) / 100) }));
                                }
                              }
                            }}
                            placeholder="e.g. 15.00"
                            className="w-full max-w-28 rounded border border-[#253451] bg-[#080f20] px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        ) : (
                          <span className={effPrice > 0 ? 'text-cyan-300' : 'text-slate-600'}>
                            {effPrice > 0 ? formatPHP(effPrice) : 'Not set'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {margin != null ? (
                          <span className={margin < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                            {formatPHP(margin)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.badge}
                            onChange={(e) => setEditForm((p) => ({ ...p, badge: e.target.value }))}
                            placeholder="e.g. Popular"
                            className="w-full max-w-24 rounded border border-[#253451] bg-[#080f20] px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        ) : (
                          pkg.badge ? (
                            <span className="rounded bg-[#1b2a45] px-2 py-0.5 text-xs text-slate-300">{pkg.badge}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editForm.sort_order}
                            onChange={(e) => setEditForm((p) => ({ ...p, sort_order: e.target.value }))}
                            className="w-full max-w-16 rounded border border-[#253451] bg-[#080f20] px-2 py-1 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        ) : (
                          <span className="text-slate-400">{pkg.sort_order}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(pkg)}
                          className="transition"
                        >
                          {pkg.is_active ? (
                            <ToggleRight className="h-6 w-6 text-emerald-400" />
                          ) : (
                            <ToggleLeft className="h-6 w-6 text-slate-600" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleSave(pkg)}
                              disabled={saving}
                              className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-400 transition hover:bg-emerald-500/10"
                            >
                              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded border border-[#253451] px-2 py-1 text-xs text-slate-400"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : isSaved ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(pkg)}
                            className="rounded border border-[#253451] px-2.5 py-1 text-xs text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Card layout: tablet and below — no horizontal scrolling */}
          <div className="grid gap-3 md:hidden">
            {packages.map((pkg) => {
              const isEditing = editingId === pkg.id;
              const isSaved = savedIds.has(pkg.id);
              const margin = marginCents(pkg, previewRate);
              const effPrice = effectivePriceCents(pkg, previewRate);

              return (
                <div key={pkg.id} className="rounded-xl border border-[#1b2a45] bg-[#0a1124] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-medium text-slate-200">{pkg.name}</h3>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={pkg.supplier_offer_id || ''}>
                        {pkg.supplier_offer_id || '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(pkg)}
                      className="shrink-0 transition"
                    >
                      {pkg.is_active ? (
                        <ToggleRight className="h-6 w-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-slate-600" />
                      )}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2.5">
                      <span className="text-slate-500">Cost (USD)</span>
                      <p className="mt-0.5 font-semibold text-amber-400">{pkg.supplier_cost_usd ? `${pkg.supplier_cost_usd}` : '—'}</p>
                    </div>
                    <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2.5">
                      <span className="text-slate-500">Price (PHP)</span>
                      <p className={`mt-0.5 font-semibold ${effPrice > 0 ? 'text-cyan-300' : 'text-slate-600'}`}>
                        {effPrice > 0 ? formatPHP(effPrice) : 'Not set'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2.5">
                      <span className="text-slate-500">Margin</span>
                      <p className={`mt-0.5 font-semibold ${margin == null ? 'text-slate-600' : margin < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {margin != null ? formatPHP(margin) : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2.5">
                      <span className="text-slate-500">Markup</span>
                      <p className={`mt-0.5 font-semibold ${pkg.markup_percent != null ? 'text-cyan-300' : 'text-slate-600'}`}>
                        {pkg.markup_percent != null ? `${parseFloat(pkg.markup_percent).toFixed(2)}%` : '—'}
                      </p>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-[11px] text-slate-500">Price (PHP)
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.price_php}
                            onChange={(e) => {
                              setEditForm((p) => ({ ...p, price_php: e.target.value }));
                              if (pkg.supplier_cost_usd) {
                                const costUsd = parseFloat(pkg.supplier_cost_usd);
                                const priceCents = phpToCents(e.target.value);
                                if (costUsd > 0 && priceCents > 0) {
                                  const costPHP = costUsd * fxRate;
                                  const sellingPHP = priceCents / 100;
                                  const computedMarkup = ((sellingPHP / costPHP) - 1) * 100;
                                  setEditForm((p) => ({ ...p, markup_percent: String(Math.round(computedMarkup * 100) / 100) }));
                                }
                              }
                            }}
                            className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        </label>
                        <label className="block text-[11px] text-slate-500">Markup %
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.markup_percent}
                            onChange={(e) => {
                              const markup = parseFloat(e.target.value);
                              setEditForm((p) => ({ ...p, markup_percent: e.target.value }));
                              if (pkg.supplier_cost_usd && !Number.isNaN(markup)) {
                                const costUsd = parseFloat(pkg.supplier_cost_usd);
                                if (costUsd > 0) {
                                  const costPHP = costUsd * fxRate;
                                  const sellingPHP = costPHP * (1 + markup / 100);
                                  setEditForm((p) => ({ ...p, price_php: sellingPHP.toFixed(2) }));
                                }
                              }
                            }}
                            className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-[11px] text-slate-500">Badge
                          <input
                            type="text"
                            value={editForm.badge}
                            onChange={(e) => setEditForm((p) => ({ ...p, badge: e.target.value }))}
                            placeholder="e.g. Popular"
                            className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        </label>
                        <label className="block text-[11px] text-slate-500">Sort
                          <input
                            type="number"
                            value={editForm.sort_order}
                            onChange={(e) => setEditForm((p) => ({ ...p, sort_order: e.target.value }))}
                            className="mt-1 w-full rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
                          />
                        </label>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSave(pkg)}
                          disabled={saving}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-500/30 px-3 py-2 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-[#253451] px-3 py-2 text-xs text-slate-400 hover:text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>Sort {pkg.sort_order}</span>
                        {pkg.badge && <span className="rounded bg-[#1b2a45] px-2 py-0.5 text-slate-300">{pkg.badge}</span>}
                      </div>
                      {isSaved ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3.5 w-3.5" /> Saved</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(pkg)}
                          className="rounded-lg border border-[#253451] px-3 py-1.5 text-xs text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* FX rate card + margin note */}
      <div className="mt-4 rounded-lg border border-[#1b2a45] bg-[#0b1225] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Reference USD to PHP Rate</h3>
            <p className="mt-1 text-xs text-slate-500">
              Used to auto-calculate selling prices from supplier cost and markup.
              Changing this rate recalculates all packages with a markup % set.
              This rate never modifies supplier orders or supplier cost.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {/* Live rate display */}
            <div className="flex items-center gap-2 rounded-lg border border-[#1b2a45] bg-[#080f20] px-3 py-2">
              <TrendingUp className="h-4 w-4 text-cyan-300" />
              <span className="text-xs text-slate-500">Live:</span>
              {liveRateLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
              ) : liveRate != null ? (
                <span className="text-sm font-semibold text-cyan-300">₱{liveRate.toFixed(2)}</span>
              ) : (
                <span className="text-xs text-rose-400">{liveRateError || 'N/A'}</span>
              )}
              <button
                type="button"
                onClick={fetchLiveRate}
                disabled={liveRateLoading}
                className="ml-1 text-xs text-slate-500 transition hover:text-cyan-300"
              >
                <RefreshCw className={`h-3 w-3 ${liveRateLoading ? 'animate-spin' : ''}`} />
              </button>
              {liveRate != null && (
                <button
                  type="button"
                  onClick={() => setFxRateInput(String(liveRate))}
                  className="ml-1 rounded border border-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400 transition hover:bg-cyan-500/10"
                >
                  Use
                </button>
              )}
            </div>
            {/* Manual rate input */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">$1 =</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1000"
                value={fxRateInput || String(fxRate)}
                onChange={(e) => setFxRateInput(e.target.value)}
                className="w-20 rounded border border-[#253451] bg-[#080f20] px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
              />
              <span className="text-sm text-slate-400">PHP</span>
              <button
                type="button"
                onClick={handleSaveFxRate}
                disabled={fxSaving}
                className="inline-flex items-center gap-1 rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-300 transition hover:bg-cyan-500/10 disabled:opacity-50"
              >
                {fxSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : fxSaved ? <Check className="h-3 w-3" /> : 'Save & Recalculate'}
              </button>
            </div>
          </div>
        </div>
        {recalculatedCount != null && (
          <div className="mt-2 text-xs text-cyan-300">
            <Check className="mr-1 inline h-3 w-3" />
            Recalculated {recalculatedCount} package{recalculatedCount === 1 ? '' : 's'} with markup %.
          </div>
        )}
        <div className="mt-3 border-t border-[#1b2a45] pt-3">
          <p className="text-xs leading-relaxed text-slate-500">
            <span className="font-medium text-slate-400">Pricing formula:</span>{' '}
            cost_php = supplier_cost_usd × {previewRate}{'  '}
            <span className="text-slate-600">|</span>{'  '}
            selling_price_php = cost_php × (1 + markup% / 100){'  '}
            <span className="text-slate-600">|</span>{'  '}
            margin_php = selling_price_php − cost_php
          </p>
          <p className="mt-1 text-xs text-slate-600">
            The actual supplier charge is in USD. Customer price is always in PHP.
            Editing the selling price back-calculates the markup % so the margin is preserved on future rate changes.
          </p>
        </div>
      </div>
    </div>
  );
}

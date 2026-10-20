'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, Copy, Dices, Loader2, Pencil,
  Plus, RefreshCw, Tag, Trash2, X,
} from 'lucide-react';

type Voucher = {
  id: string;
  code: string;
  description: string;
  discount_type: 'PERCENTAGE' | 'FIXED';
  discount_value: number;
  min_order_cents: number;
  max_discount_cents: number | null;
  usage_limit: number | null;
  per_user_limit: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  applies_to_game_id: string | null;
  created_at: string;
};

type Usage = { voucher_id: string; email: string };

type GameOption = { id: string; name: string };

type RelatedOrder = {
  id: string;
  reference: string;
  email: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  voucher_id: string | null;
  created_at: string;
};

type FormState = {
  code: string;
  description: string;
  discount_type: 'PERCENTAGE' | 'FIXED';
  discount_value: string;
  min_order_cents: string;
  max_discount_cents: string;
  usage_limit: string;
  per_user_limit: string;
  is_active: boolean;
  applies_to_game_id: string;
  starts_at: string;
  ends_at: string;
};

const emptyForm: FormState = {
  code: '',
  description: '',
  discount_type: 'PERCENTAGE',
  discount_value: '',
  min_order_cents: '',
  max_discount_cents: '',
  usage_limit: '',
  per_user_limit: '1',
  is_active: true,
  applies_to_game_id: '',
  starts_at: '',
  ends_at: '',
};

const inputCls = 'w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-400';
const labelCls = 'mb-1 block text-xs text-slate-400';

function fmtP(cents: number): string {
  return `₱${(cents / 100).toFixed(2)}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_TONE: Record<string, string> = {
  WAITING_PAYMENT: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  PAYMENT_VERIFIED: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  PAID: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  PROCESSING: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10',
  COMPLETED: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10',
  FAILED: 'text-rose-300 border-rose-400/40 bg-rose-400/10',
  CANCELLED: 'text-slate-400 border-slate-500/40 bg-slate-500/10',
  EXPIRED: 'text-slate-400 border-slate-500/40 bg-slate-500/10',
  REFUND_PENDING: 'text-amber-300 border-amber-400/40 bg-amber-400/10',
  REFUNDED: 'text-violet-300 border-violet-400/40 bg-violet-400/10',
};

export default function VouchersClient() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [usages, setUsages] = useState<Usage[]>([]);
  const [orders, setOrders] = useState<RelatedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reportVoucherId, setReportVoucherId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [games, setGames] = useState<GameOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/admin/vouchers', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(data?.error || 'Could not load vouchers.');
        return;
      }
      setVouchers((data?.data || []) as Voucher[]);
      setUsages((data?.usages || []) as Usage[]);
      setOrders((data?.orders || []) as RelatedOrder[]);
      setGames((data?.games || []) as GameOption[]);
    } catch {
      setLoadError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const usageCount = useCallback((voucherId: string) =>
    usages.filter((u) => u.voucher_id === voucherId).length, [usages]);

  const remaining = useCallback((v: Voucher) =>
    v.usage_limit == null ? null : Math.max(0, v.usage_limit - usageCount(v.id)), [usageCount]);

  const discountGiven = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      if (!o.voucher_id) continue;
      map.set(o.voucher_id, (map.get(o.voucher_id) || 0) + (o.discount_cents || 0));
    }
    return map;
  }, [orders]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowCreate(false);
    setFormError('');
  };

  const startEdit = (v: Voucher) => {
    setEditingId(v.id);
    setShowCreate(true);
    setFormError('');
    setForm({
      code: v.code,
      description: v.description || '',
      discount_type: v.discount_type,
      discount_value: String(v.discount_value),
      min_order_cents: (v.min_order_cents / 100).toFixed(2),
      max_discount_cents: v.max_discount_cents != null ? (v.max_discount_cents / 100).toFixed(2) : '',
      usage_limit: v.usage_limit != null ? String(v.usage_limit) : '',
      per_user_limit: String(v.per_user_limit),
      is_active: v.is_active,
      applies_to_game_id: v.applies_to_game_id || '',
      starts_at: v.starts_at ? v.starts_at.slice(0, 10) : '',
      ends_at: v.ends_at ? v.ends_at.slice(0, 10) : '',
    });
  };

  const generateCode = async () => {
    setFormError('');
    try {
      const res = await fetch('/api/admin/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generate: true, prefix: 'RFZ' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.code) {
        setFormError(data?.error || 'Could not generate a code.');
        return;
      }
      setForm((f) => ({ ...f, code: data.code }));
    } catch {
      setFormError('Could not reach the server.');
    }
  };

  const save = async () => {
    setFormError('');
    const payload = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value) || 0,
      min_order_cents: Math.round((Number(form.min_order_cents) || 0) * 100),
      max_discount_cents: form.max_discount_cents.trim() ? Math.round(Number(form.max_discount_cents) * 100) : null,
      usage_limit: form.usage_limit.trim() ? Number(form.usage_limit) : null,
      per_user_limit: Number(form.per_user_limit) || 0,
      is_active: form.is_active,
      applies_to_game_id: form.applies_to_game_id || null,
      starts_at: form.starts_at ? new Date(`${form.starts_at}T00:00:00`).toISOString() : undefined,
      ends_at: form.ends_at ? new Date(`${form.ends_at}T23:59:59`).toISOString() : null,
    };

    if (!payload.code) { setFormError('Voucher code is required.'); return; }
    if (!form.discount_type || !(Number(form.discount_value) > 0)) { setFormError('Discount value must be greater than zero.'); return; }
    if (form.discount_type === 'PERCENTAGE' && Number(form.discount_value) > 100) { setFormError('Percentage discount cannot exceed 100%.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/vouchers', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.error || 'Could not save the voucher.');
        return;
      }
      setNotice(editingId ? 'Voucher updated.' : 'Voucher created.');
      setTimeout(() => setNotice(''), 2500);
      resetForm();
      await load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (v: Voucher) => {
    setTogglingId(v.id);
    setFormError('');
    try {
      const res = await fetch('/api/admin/vouchers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.id, is_active: !v.is_active }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setFormError(data?.error || 'Could not update the voucher.');
        return;
      }
      await load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (v: Voucher) => {
    if (!window.confirm(`Delete voucher ${v.code}? Vouchers with recorded usage cannot be deleted.`)) return;
    setDeletingId(v.id);
    setFormError('');
    try {
      const res = await fetch(`/api/admin/vouchers?id=${encodeURIComponent(v.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.error || 'Could not delete the voucher.');
        return;
      }
      setNotice('Voucher deleted.');
      setTimeout(() => setNotice(''), 2500);
      if (reportVoucherId === v.id) setReportVoucherId(null);
      await load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setDeletingId(null);
    }
  };

  const copyCode = async (v: Voucher) => {
    try {
      await navigator.clipboard.writeText(v.code);
      setCopiedId(v.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const reportVoucher = vouchers.find((v) => v.id === reportVoucherId) || null;
  const reportOrders = orders.filter((o) => o.voucher_id === reportVoucherId);

  return (
    <div className="space-y-4">
      {(formError || loadError) && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">
          <AlertTriangle size={14} /> {loadError || formError}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 size={14} /> {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => { setShowCreate((s) => !s); setEditingId(null); setForm(emptyForm); setFormError(''); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          {showCreate && !editingId ? <X size={16} /> : <Plus size={16} />} {showCreate && !editingId ? 'Cancel' : 'Add Voucher'}
        </button>
        <button
          onClick={() => { void load(); }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#0b1225] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            {editingId ? <Pencil size={16} className="text-cyan-300" /> : <Plus size={16} className="text-cyan-300" />}
            {editingId ? 'Edit Voucher' : 'New Voucher'}
          </h3>

          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Voucher Code *</span>
                <div className="flex gap-2">
                  <input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. SAVE10"
                    maxLength={50}
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => { void generateCode(); }}
                    title="Generate a unique code"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20"
                  >
                    <Dices size={14} /> Generate
                  </button>
                </div>
              </label>
              <label className="block">
                <span className={labelCls}>Discount Type</span>
                <select
                  value={form.discount_type}
                  onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as FormState['discount_type'] }))}
                  className={inputCls}
                >
                  <option value="PERCENTAGE">Percentage (%)</option>
                  <option value="FIXED">Fixed Amount (₱)</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={labelCls}>{form.discount_type === 'PERCENTAGE' ? 'Percent Off *' : 'Amount Off (₱) *'}</span>
                <input
                  type="number"
                  min="0"
                  step={form.discount_type === 'PERCENTAGE' ? '1' : '0.01'}
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                  placeholder={form.discount_type === 'PERCENTAGE' ? 'e.g. 10' : 'e.g. 50.00'}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Minimum Order (₱)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.min_order_cents}
                  onChange={(e) => setForm((f) => ({ ...f, min_order_cents: e.target.value }))}
                  placeholder="0 = no minimum"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Max Discount (₱) {form.discount_type === 'PERCENTAGE' ? '' : '(percentage only)'}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.max_discount_cents}
                  onChange={(e) => setForm((f) => ({ ...f, max_discount_cents: e.target.value }))}
                  placeholder="No cap"
                  disabled={form.discount_type === 'FIXED'}
                  className={`${inputCls} disabled:opacity-40`}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={labelCls}>Total Usage Limit</span>
                <input
                  type="number"
                  min="0"
                  value={form.usage_limit}
                  onChange={(e) => setForm((f) => ({ ...f, usage_limit: e.target.value }))}
                  placeholder="Empty = unlimited"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Per-Customer Limit</span>
                <input
                  type="number"
                  min="0"
                  value={form.per_user_limit}
                  onChange={(e) => setForm((f) => ({ ...f, per_user_limit: e.target.value }))}
                  placeholder="0 = unlimited"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Status</span>
                <select
                  value={form.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'active' }))}
                  className={inputCls}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Start Date</span>
                <input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>End Date</span>
                <input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm((f) => ({ ...f, ends_at: e.target.value }))}
                  className={inputCls}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelCls}>Description (shown to admin only)</span>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Launch promo for new customers"
                maxLength={200}
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className={labelCls}>Valid For (game restriction)</span>
              <select
                value={form.applies_to_game_id}
                onChange={(e) => setForm((f) => ({ ...f, applies_to_game_id: e.target.value }))}
                className={inputCls}
              >
                <option value="">All games and packages</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>

            {formError && <p className="text-sm text-rose-400">{formError}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={resetForm} className="flex-1 rounded-lg border border-[#253451] px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void save(); }}
                disabled={saving}
                className="flex-[2] rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Loader2 size={16} className="mx-auto animate-spin" /> : editingId ? 'Save Changes' : 'Create Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16">
          <Loader2 size={24} className="animate-spin text-cyan-300" />
        </div>
      ) : vouchers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#1b2a45] bg-[#0b1225] py-16 text-center">
          <Tag size={32} className="mb-3 text-slate-600" />
          <p className="text-sm font-medium text-slate-400">No vouchers yet</p>
          <p className="mt-1 text-xs text-slate-600">Create a discount code to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vouchers.map((v) => {
            const used = usageCount(v.id);
            const rem = remaining(v);
            const now = new Date();
            const expired = v.ends_at ? new Date(v.ends_at) < now : false;
            const notYet = new Date(v.starts_at) > now;
            return (
              <div key={v.id} className="flex flex-col rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
                <div className="flex items-center justify-between">
                  <Tag className="text-cyan-300" size={18} />
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${v.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/20 text-slate-400'}`}>
                    {v.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <h3 className="font-mono text-lg font-bold text-cyan-300">{v.code}</h3>
                  <button type="button" onClick={() => { void copyCode(v); }} title="Copy code" className="text-slate-500 transition hover:text-cyan-300">
                    {copiedId === v.id ? <CheckCircle2 size={13} className="text-emerald-300" /> : <Copy size={13} />}
                  </button>
                </div>
                {v.description && <p className="mt-0.5 truncate text-xs text-slate-400">{v.description}</p>}
                <div className="mt-3 flex justify-between text-xs">
                  <span className="text-slate-300">{v.discount_type === 'PERCENTAGE' ? `${v.discount_value}% off` : `${fmtP(v.discount_value)} off`}</span>
                  <span className="text-slate-500">Min {fmtP(v.min_order_cents)}</span>
                </div>
                {v.discount_type === 'PERCENTAGE' && v.max_discount_cents != null && (
                  <p className="mt-1 text-[10px] text-slate-500">Capped at {fmtP(v.max_discount_cents)}</p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Used</p>
                    <p className="text-sm font-bold text-slate-200">{used}</p>
                  </div>
                  <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Remaining</p>
                    <p className="text-sm font-bold text-slate-200">{rem === null ? '∞' : rem}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-[10px] text-slate-500">
                  <p>Per customer: {v.per_user_limit > 0 ? `${v.per_user_limit}×` : 'unlimited'} · Limit: {v.usage_limit ?? 'unlimited'}</p>
                  <p>Valid {fmtDate(v.starts_at)} → {fmtDate(v.ends_at)}</p>
                  {expired && <p className="text-rose-300">Expired</p>}
                  {notYet && <p className="text-amber-300">Not started yet</p>}
                </div>
                <div className="mt-4 flex gap-2 border-t border-[#1b2a45] pt-3">
                  <button
                    type="button"
                    onClick={() => { void toggleActive(v); }}
                    disabled={togglingId === v.id}
                    className="flex-1 rounded-lg border border-[#253451] px-2 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                  >
                    {togglingId === v.id ? '…' : v.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(v)}
                    className="flex-1 rounded-lg border border-[#253451] px-2 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => { setReportVoucherId(v.id === reportVoucherId ? null : v.id); }}
                    title="Show usage report"
                    className="flex-1 rounded-lg border border-[#253451] px-2 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
                  >
                    <BarChart3 size={12} className="mx-auto" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { void remove(v); }}
                    disabled={deletingId === v.id}
                    title="Delete voucher"
                    className="rounded-lg border border-[#253451] px-2 py-1.5 text-[11px] text-slate-400 transition hover:border-rose-400 hover:text-rose-300 disabled:opacity-40"
                  >
                    {deletingId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reportVoucher && (
        <div className="rounded-xl border border-cyan-500/30 bg-[#0b1225] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              Usage Report — <span className="font-mono text-cyan-300">{reportVoucher.code}</span>
            </h3>
            <button type="button" onClick={() => setReportVoucherId(null)} className="text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Times Used</p>
              <p className="mt-1 font-display text-lg font-bold text-slate-100">{usageCount(reportVoucher.id)}</p>
            </div>
            <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Discount Given</p>
              <p className="mt-1 font-display text-lg font-bold text-emerald-300">{fmtP(discountGiven.get(reportVoucher.id) || 0)}</p>
            </div>
            <div className="rounded-lg border border-[#1b2a45] bg-[#080f20] p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Remaining</p>
              <p className="mt-1 font-display text-lg font-bold text-slate-100">
                {remaining(reportVoucher) === null ? '∞' : remaining(reportVoucher)}
              </p>
            </div>
          </div>

          {reportOrders.length === 0 ? (
            <p className="mt-4 text-xs text-slate-500">No orders have used this voucher yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1b2a45] text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Subtotal</th>
                    <th className="py-2 pr-3 text-right">Discount</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reportOrders.map((o) => (
                    <tr key={o.id} className="border-b border-[#14203a]">
                      <td className="py-2 pr-3 font-mono text-cyan-300">{o.reference}</td>
                      <td className="max-w-[160px] truncate py-2 pr-3 text-slate-300">{o.email}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${STATUS_TONE[o.status] || 'text-slate-300 border-slate-500/40 bg-slate-500/10'}`}>
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-300">{fmtP(o.subtotal_cents)}</td>
                      <td className="py-2 pr-3 text-right text-emerald-300">−{fmtP(o.discount_cents)}</td>
                      <td className="py-2 text-right font-semibold text-slate-100">{fmtP(o.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

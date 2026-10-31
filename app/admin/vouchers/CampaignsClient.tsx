'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, BarChart3, Check, Copy, Eye, Loader2, Pause, Play, Plus, RefreshCw, Search, X } from 'lucide-react';
import {
  formatCampaignDate,
  isoToZonedDateTimeInput,
  normalizeCampaignCode,
  parseMoneyCents,
  zonedDateTimeToIso,
  type CampaignStatus,
  type CampaignType,
} from '@/lib/voucherCampaign';

type GameOption = { id: string; name: string; slug: string; catalog_status: string; is_active: boolean };
type PackageOption = { id: string; game_id: string; name: string; price_cents: number; catalog_status: string; is_active: boolean; supplier_review_required: boolean };
type Campaign = {
  id: string; voucher_id: string; name: string; description: string; campaign_type: CampaignType;
  effective_status: CampaignStatus; stored_status: CampaignStatus; timezone: string;
  starts_at: string; ends_at: string | null; eligibility_rules: Record<string, unknown>;
  total_redemption_limit: number | null; per_customer_redemption_limit: number | null;
  discount_budget_cents: number | null; public_discovery: boolean; legacy_compatibility: boolean;
  code: string; discount_type: 'PERCENTAGE' | 'FIXED'; discount_value: number;
  min_order_cents: number; max_discount_cents: number | null; usage_limit: number | null;
  per_user_limit: number; reserved_uses: number; committed_uses: number; released_uses: number;
  reserved_discount_cents: number; committed_discount_cents: number; active_discount_cents: number;
  remaining_budget_cents: number | null; game_ids: string[]; package_ids: string[];
  updated_at: string;
};
type Preview = {
  valid: boolean; reason: string | null; subtotal_cents: number; discount_cents: number; total_cents: number;
  eligible_customer_modes: { new_authenticated: boolean; returning_authenticated: boolean; guest: boolean };
  note: string;
};
type FormState = {
  name: string; description: string; campaign_type: CampaignType; code: string;
  discount_type: 'PERCENTAGE' | 'FIXED'; discount_value: string;
  min_order: string; max_discount: string; total_limit: string; customer_limit: string;
  budget: string; starts_at: string; ends_at: string; timezone: string;
  game_ids: string[]; package_ids: string[]; allow_guest: boolean;
  min_completed_orders: string; max_completed_orders: string; public_discovery: boolean;
};

const TYPE_LABELS: Record<CampaignType, string> = {
  WELCOME: 'Welcome', SEASONAL: 'Seasonal', GAME_SPECIFIC: 'Game-specific',
  PACKAGE_SPECIFIC: 'Package-specific', LIMITED_REDEMPTION: 'Limited redemption',
  CUSTOMER_RETENTION: 'Customer retention', PUBLIC_PROMOTION: 'Public promotion', PRIVATE_CODE: 'Private code',
};
const STATUSES: CampaignStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED'];
const TIMEZONES = ['UTC', 'Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London'];
const inputClass = 'w-full rounded-xl border border-[#263854] bg-[#071126] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20';
const labelClass = 'mb-1.5 block text-xs font-medium text-slate-400';

function pesos(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function freshForm(): FormState {
  const timezone = TIMEZONES.includes(Intl.DateTimeFormat().resolvedOptions().timeZone)
    ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Manila';
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    name: '', description: '', campaign_type: 'SEASONAL', code: '', discount_type: 'PERCENTAGE',
    discount_value: '10', min_order: '0.00', max_discount: '', total_limit: '100', customer_limit: '1',
    budget: '500.00', starts_at: isoToZonedDateTimeInput(start, timezone), ends_at: '', timezone,
    game_ids: [], package_ids: [], allow_guest: true, min_completed_orders: '', max_completed_orders: '',
    public_discovery: false,
  };
}

function toForm(campaign: Campaign): FormState {
  const rules = campaign.eligibility_rules || {};
  return {
    name: campaign.name, description: campaign.description || '', campaign_type: campaign.campaign_type,
    code: campaign.code, discount_type: campaign.discount_type, discount_value: String(campaign.discount_value),
    min_order: (campaign.min_order_cents / 100).toFixed(2),
    max_discount: campaign.max_discount_cents == null ? '' : (campaign.max_discount_cents / 100).toFixed(2),
    total_limit: campaign.total_redemption_limit == null ? '' : String(campaign.total_redemption_limit),
    customer_limit: campaign.per_customer_redemption_limit == null ? '' : String(campaign.per_customer_redemption_limit),
    budget: campaign.discount_budget_cents == null ? '' : (campaign.discount_budget_cents / 100).toFixed(2),
    starts_at: isoToZonedDateTimeInput(campaign.starts_at, campaign.timezone),
    ends_at: isoToZonedDateTimeInput(campaign.ends_at || '', campaign.timezone),
    timezone: campaign.timezone, game_ids: campaign.game_ids || [], package_ids: campaign.package_ids || [],
    allow_guest: rules.allow_guest === true,
    min_completed_orders: rules.min_completed_orders == null ? '' : String(rules.min_completed_orders),
    max_completed_orders: rules.max_completed_orders == null ? '' : String(rules.max_completed_orders),
    public_discovery: campaign.public_discovery,
  };
}

function payloadFor(form: FormState): Record<string, unknown> | string {
  const startsAt = zonedDateTimeToIso(form.starts_at, form.timezone);
  const endsAt = form.ends_at ? zonedDateTimeToIso(form.ends_at, form.timezone) : null;
  const minOrder = parseMoneyCents(form.min_order);
  const maxDiscount = form.max_discount.trim() ? parseMoneyCents(form.max_discount) : null;
  const budget = parseMoneyCents(form.budget);
  const discountValue = form.discount_type === 'FIXED' ? parseMoneyCents(form.discount_value) : Number(form.discount_value);
  const totalLimit = form.total_limit.trim() ? Number(form.total_limit) : null;
  const customerLimit = form.customer_limit.trim() ? Number(form.customer_limit) : null;
  const minCompleted = form.min_completed_orders.trim() ? Number(form.min_completed_orders) : null;
  const maxCompleted = form.max_completed_orders.trim() ? Number(form.max_completed_orders) : null;
  if (!form.name.trim() || form.name.trim().length > 100) return 'Campaign name is required (100 characters max).';
  if (!/^[A-Z0-9][A-Z0-9-]{2,39}$/.test(normalizeCampaignCode(form.code))) return 'Use a unique 3–40 character code with letters, numbers, and hyphens.';
  if (form.discount_type === 'PERCENTAGE' && (!Number.isInteger(discountValue) || Number(discountValue) < 1 || Number(discountValue) > 100)) return 'Percentage discount must be an integer from 1 to 100.';
  if (discountValue == null || !Number.isSafeInteger(discountValue) || discountValue <= 0) return 'Discount value must be greater than zero.';
  if (minOrder == null || (form.min_order.trim() && minOrder < 0)) return 'Minimum purchase must be a valid PHP amount.';
  if (form.max_discount.trim() && (maxDiscount == null || maxDiscount <= 0)) return 'Maximum discount must be a positive PHP amount.';
  if (budget == null || budget <= 0) return 'A positive total discount budget is required.';
  if (totalLimit != null && (!Number.isSafeInteger(totalLimit) || totalLimit <= 0)) return 'Total redemption limit must be a positive whole number.';
  if (customerLimit != null && (!Number.isSafeInteger(customerLimit) || customerLimit <= 0)) return 'Per-customer limit must be a positive whole number.';
  if (!startsAt) return 'Choose a valid start time and timezone.';
  if (form.ends_at && !endsAt) return 'Choose a valid end time and timezone.';
  if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return 'End time must be after start time.';
  if (form.campaign_type === 'GAME_SPECIFIC' && form.game_ids.length === 0) return 'Select at least one eligible game.';
  if (form.campaign_type === 'PACKAGE_SPECIFIC' && form.package_ids.length === 0) return 'Select at least one eligible package.';
  if (minCompleted != null && (!Number.isSafeInteger(minCompleted) || minCompleted < 0)) return 'Minimum completed purchases must be a non-negative whole number.';
  if (maxCompleted != null && (!Number.isSafeInteger(maxCompleted) || maxCompleted < 0 || (minCompleted != null && maxCompleted < minCompleted))) return 'Maximum completed purchases must be at least the minimum.';
  const isPublic = form.campaign_type === 'PUBLIC_PROMOTION' || form.public_discovery;
  if (form.campaign_type === 'PRIVATE_CODE' && isPublic) return 'Private codes cannot be publicly discoverable.';
  return {
    name: form.name.trim(), description: form.description.trim(), campaign_type: form.campaign_type,
    code: normalizeCampaignCode(form.code), discount_type: form.discount_type, discount_value: discountValue,
    min_order_cents: minOrder, max_discount_cents: maxDiscount, total_redemption_limit: totalLimit,
    per_customer_redemption_limit: customerLimit, discount_budget_cents: budget,
    starts_at: startsAt, ends_at: endsAt, timezone: form.timezone,
    eligibility_rules: {
      allow_guest: form.campaign_type === 'WELCOME' || form.campaign_type === 'CUSTOMER_RETENTION' ? false : form.allow_guest,
      require_authenticated: form.campaign_type === 'WELCOME' || form.campaign_type === 'CUSTOMER_RETENTION',
      ...(minCompleted == null ? {} : { min_completed_orders: minCompleted }),
      ...(maxCompleted == null ? {} : { max_completed_orders: maxCompleted }),
    },
    public_discovery: isPublic, game_ids: form.game_ids, package_ids: form.package_ids,
  };
}

export default function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [games, setGames] = useState<GameOption[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState<FormState>(freshForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('recent');
  const [previewCampaign, setPreviewCampaign] = useState<Campaign | null>(null);
  const [previewPackageId, setPreviewPackageId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<{ summary?: Record<string, number>; redemptions?: Array<Record<string, unknown>>; audit?: Array<Record<string, unknown>> } | null>(null);
  const [reportCampaign, setReportCampaign] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/admin/vouchers/campaigns', { cache: 'no-store' });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setLoadError(result?.error || 'Could not load campaigns.'); return; }
      setCampaigns((result?.data || []) as Campaign[]);
      setGames((result?.games || []) as GameOption[]);
      setPackages((result?.packages || []) as PackageOption[]);
    } catch { setLoadError('Could not reach the campaign service.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleCampaigns = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = campaigns.filter((campaign) =>
      (statusFilter === 'ALL' || campaign.effective_status === statusFilter)
      && (typeFilter === 'ALL' || campaign.campaign_type === typeFilter)
      && (!term || `${campaign.name} ${campaign.code} ${campaign.description}`.toLowerCase().includes(term)));
    return rows.sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name)
      : sortBy === 'budget' ? (b.active_discount_cents || 0) - (a.active_discount_cents || 0)
        : new Date(b.updated_at || b.starts_at).getTime() - new Date(a.updated_at || a.starts_at).getTime());
  }, [campaigns, search, sortBy, statusFilter, typeFilter]);

  const closeForm = () => { setShowForm(false); setEditing(null); setForm(freshForm()); setFormError(''); };
  const openCreate = () => { setEditing(null); setForm(freshForm()); setFormError(''); setShowForm(true); };
  const openEdit = (campaign: Campaign) => {
    setEditing(campaign); setForm(toForm(campaign)); setFormError(''); setShowForm(true);
  };

  const toggleId = (field: 'game_ids' | 'package_ids', id: string) => {
    setForm((current) => ({ ...current, [field]: current[field].includes(id)
      ? current[field].filter((value) => value !== id) : [...current[field], id] }));
  };

  const save = async () => {
    setFormError('');
    const payload = payloadFor(form);
    if (typeof payload === 'string') { setFormError(payload); return; }
    setSaving(true);
    try {
      const response = await fetch('/api/admin/vouchers/campaigns', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setFormError(result?.error || 'Could not save the campaign.'); return; }
      setNotice(editing ? 'Campaign settings saved.' : 'Campaign saved as a draft.');
      closeForm(); await load();
    } catch { setFormError('Could not reach the campaign service.'); }
    finally { setSaving(false); }
  };

  const changeStatus = async (campaign: Campaign, status: CampaignStatus): Promise<boolean> => {
    setBusyId(campaign.id); setFormError('');
    try {
      const response = await fetch('/api/admin/vouchers/campaigns', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'status', id: campaign.id, status }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setFormError(result?.error || 'Campaign status did not change.'); return false; }
      setNotice(`${campaign.name}: ${String(result?.data?.out_status || status).toLowerCase()}.`);
      await load();
      return true;
    } catch { setFormError('Could not reach the campaign service.'); }
    finally { setBusyId(null); }
    return false;
  };

  const duplicate = async (campaign: Campaign) => {
    setBusyId(campaign.id);
    try {
      const response = await fetch('/api/admin/vouchers/campaigns', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate', id: campaign.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setFormError(result?.error || 'Could not duplicate this campaign.'); return; }
      setNotice('A new draft campaign was created.'); await load();
    } catch { setFormError('Could not reach the campaign service.'); }
    finally { setBusyId(null); }
  };

  const archive = async (campaign: Campaign) => {
    if (!window.confirm(`Archive “${campaign.name}”? Redemption history will remain available.`)) return;
    const hasPassedEnd = Boolean(campaign.ends_at && new Date(campaign.ends_at).getTime() <= Date.now());
    const intermediateStatus = hasPassedEnd && ['ACTIVE', 'SCHEDULED'].includes(campaign.stored_status)
      ? 'ENDED' : campaign.stored_status === 'ACTIVE' ? 'PAUSED' : null;
    if (intermediateStatus && !(await changeStatus(campaign, intermediateStatus))) return;
    const response = await fetch('/api/admin/vouchers/campaigns', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'status', id: campaign.id, status: 'ARCHIVED' }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setFormError(result?.error || 'Campaign could not be archived.'); return; }
    setNotice('Campaign archived; redemption and audit history were preserved.'); await load();
  };

  const duplicateCode = async () => {
    try {
      const response = await fetch('/api/admin/vouchers/campaigns', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'generate-code' }),
      });
      const result = await response.json();
      if (response.ok && typeof result.code === 'string') setForm((current) => ({ ...current, code: result.code }));
    } catch { setFormError('Could not generate a voucher code.'); }
  };

  const openPreview = (campaign: Campaign) => {
    setPreviewCampaign(campaign); setPreview(null);
    setPreviewPackageId(packages.find((pkg) => pkg.catalog_status === 'PUBLISHED' && pkg.is_active)?.id || '');
  };
  const runPreview = async () => {
    if (!previewCampaign || !previewPackageId) return;
    const response = await fetch('/api/admin/vouchers/campaigns/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignId: previewCampaign.id, packageId: previewPackageId }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setFormError(result?.error || 'Could not preview campaign.'); return; }
    setPreview(result?.data as Preview);
  };
  const openReport = async (campaign: Campaign) => {
    setReportCampaign(campaign); setReport(null);
    const response = await fetch(`/api/admin/vouchers/campaigns/${campaign.id}/report?limit=50`, { cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok) { setFormError(result?.error || 'Could not load campaign report.'); return; }
    setReport(result?.data || null);
  };

  const campaignTypeChange = (campaign_type: CampaignType) => setForm((current) => ({
    ...current,
    campaign_type,
    public_discovery: campaign_type === 'PUBLIC_PROMOTION' ? true : campaign_type === 'PRIVATE_CODE' ? false : current.public_discovery,
    allow_guest: campaign_type === 'WELCOME' || campaign_type === 'CUSTOMER_RETENTION' ? false : current.allow_guest,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <p>Campaigns control discounts only. Payment, supplier fulfillment, and RF Coins release locks remain independent and unchanged.</p>
        <span className="shrink-0 rounded-full border border-amber-200/20 px-3 py-1 font-semibold">FINANCIAL ACTIVATION OFF</span>
      </div>

      {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm text-emerald-200"><Check size={16} />{notice}<button className="ml-auto" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {formError && <div role="alert" className="rounded-xl border border-rose-300/25 bg-rose-300/10 p-3 text-sm text-rose-200">{formError}</div>}
      {loadError && <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-300/25 bg-rose-300/10 p-3 text-sm text-rose-200">{loadError}<button onClick={() => void load()} className="inline-flex items-center gap-2"><RefreshCw size={14} />Retry</button></div>}

      <section className="rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5" aria-label="Campaign controls">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search campaigns" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search names, descriptions or codes" className={`${inputClass} pl-9`} /></div>
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} lg:w-44`}><option value="ALL">All statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
          <select aria-label="Filter by campaign type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={`${inputClass} lg:w-48`}><option value="ALL">All campaign types</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Sort campaigns" value={sortBy} onChange={(event) => setSortBy(event.target.value)} className={`${inputClass} lg:w-40`}><option value="recent">Recently updated</option><option value="name">Name A–Z</option><option value="budget">Discounts used</option></select>
          <button onClick={() => void load()} aria-label="Refresh campaigns" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#263854] px-4 text-sm text-slate-300 hover:border-cyan-300"><RefreshCw size={15} />Refresh</button>
          <button onClick={openCreate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 text-sm font-bold text-white"><Plus size={16} />New campaign</button>
        </div>
      </section>

      {loading ? <div className="flex items-center justify-center gap-3 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-12 text-slate-400"><Loader2 className="animate-spin" size={18} />Loading campaign records…</div>
        : visibleCampaigns.length === 0 ? <div className="rounded-2xl border border-dashed border-[#2a3b58] bg-[#0b1225] p-10 text-center text-sm text-slate-400">{campaigns.length ? 'No campaigns match the current filters.' : 'No campaigns exist yet. New campaigns are always saved as drafts.'}</div>
          : <div className="grid gap-4 xl:grid-cols-2">
            {visibleCampaigns.map((campaign) => {
              const locked = campaign.effective_status === 'ACTIVE';
              const used = campaign.reserved_discount_cents + campaign.committed_discount_cents;
              const usageCount = campaign.reserved_uses + campaign.committed_uses;
              const statusClass = campaign.effective_status === 'ACTIVE' ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
                : campaign.effective_status === 'SCHEDULED' ? 'border-blue-300/30 bg-blue-300/10 text-blue-200'
                  : campaign.effective_status === 'PAUSED' ? 'border-amber-300/30 bg-amber-300/10 text-amber-100'
                    : 'border-slate-500/30 bg-slate-500/10 text-slate-300';
              return <article key={campaign.id} className="rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-4 sm:p-5" aria-label={`${campaign.name} campaign`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-100">{campaign.name}</h2><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ${statusClass}`}>{campaign.effective_status}</span>{campaign.legacy_compatibility && <span className="rounded-full border border-violet-300/20 bg-violet-300/5 px-2 py-1 text-[10px] text-violet-200">LEGACY CODE</span>}</div><p className="mt-1 text-xs text-slate-400">{TYPE_LABELS[campaign.campaign_type]} · <span className="font-mono text-cyan-200">{campaign.code}</span>{campaign.public_discovery ? ' · public discovery' : ' · private code'}</p></div>
                  <div className="rounded-xl border border-[#223451] bg-[#081329] px-3 py-2 text-right"><p className="text-[10px] uppercase tracking-wide text-slate-500">Discount</p><p className="text-sm font-bold text-emerald-200">{campaign.discount_type === 'PERCENTAGE' ? `${campaign.discount_value}%` : pesos(campaign.discount_value)}</p></div>
                </div>
                {campaign.description && <p className="mt-3 text-xs leading-5 text-slate-400">{campaign.description}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg bg-[#081329] p-2.5"><span className="block text-[10px] uppercase text-slate-500">Schedule</span><span className="mt-1 block text-slate-200">{formatCampaignDate(campaign.starts_at, campaign.timezone)}</span><span className="block text-slate-500">to {formatCampaignDate(campaign.ends_at, campaign.timezone)}</span></div>
                  <div className="rounded-lg bg-[#081329] p-2.5"><span className="block text-[10px] uppercase text-slate-500">Redemptions</span><span className="mt-1 block text-slate-200">{usageCount}{campaign.total_redemption_limit == null ? ' / ∞' : ` / ${campaign.total_redemption_limit}`}</span><span className="block text-slate-500">{campaign.released_uses} released</span></div>
                  <div className="rounded-lg bg-[#081329] p-2.5"><span className="block text-[10px] uppercase text-slate-500">Discount used</span><span className="mt-1 block text-slate-200">{pesos(used)}</span><span className="block text-slate-500">{campaign.per_customer_redemption_limit ?? '∞'} per customer</span></div>
                  <div className="rounded-lg bg-[#081329] p-2.5"><span className="block text-[10px] uppercase text-slate-500">Budget remaining</span><span className="mt-1 block text-slate-200">{campaign.remaining_budget_cents == null ? 'Unlimited (legacy)' : pesos(campaign.remaining_budget_cents)}</span><span className="block text-slate-500">cap {campaign.discount_budget_cents == null ? 'not set' : pesos(campaign.discount_budget_cents)}</span></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500"><span>Games: {campaign.game_ids.length ? campaign.game_ids.map((id) => games.find((game) => game.id === id)?.name || 'Selected game').join(', ') : 'All'}</span><span aria-hidden="true">·</span><span>Packages: {campaign.package_ids.length ? `${campaign.package_ids.length} selected` : 'All'}</span><span aria-hidden="true">·</span><span>{campaign.eligibility_rules.allow_guest === true ? 'Guests allowed (email limit only)' : 'Account eligibility required'}</span></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#192842] pt-4">
                  {(campaign.stored_status === 'DRAFT' || campaign.stored_status === 'SCHEDULED' || campaign.stored_status === 'PAUSED') && <button disabled={busyId === campaign.id} onClick={() => openEdit(campaign)} className="min-h-10 rounded-lg border border-[#2b405e] px-3 text-xs text-slate-200 hover:border-cyan-300 disabled:opacity-50">Edit</button>}
                  {campaign.effective_status === 'ACTIVE' && <button disabled={busyId === campaign.id} onClick={() => void changeStatus(campaign, 'PAUSED')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/30 px-3 text-xs text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"><Pause size={13} />Pause</button>}
                  {(campaign.effective_status === 'DRAFT' || campaign.effective_status === 'PAUSED') && <button disabled={busyId === campaign.id} onClick={() => void changeStatus(campaign, 'ACTIVE')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-300/30 px-3 text-xs text-emerald-100 hover:bg-emerald-300/10 disabled:opacity-50"><Play size={13} />{new Date(campaign.starts_at).getTime() > Date.now() ? 'Schedule' : 'Activate'}</button>}
                  <button disabled={busyId === campaign.id} onClick={() => void duplicate(campaign)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#2b405e] px-3 text-xs text-slate-300 hover:border-cyan-300 disabled:opacity-50"><Copy size={13} />Duplicate draft</button>
                  <button onClick={() => openPreview(campaign)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#2b405e] px-3 text-xs text-slate-300 hover:border-cyan-300"><Eye size={13} />Preview</button>
                  <button onClick={() => void openReport(campaign)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#2b405e] px-3 text-xs text-slate-300 hover:border-cyan-300"><BarChart3 size={13} />Report</button>
                  {campaign.effective_status !== 'ARCHIVED' && <button disabled={busyId === campaign.id} onClick={() => void archive(campaign)} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300/20 px-3 text-xs text-rose-200 hover:bg-rose-300/10 disabled:opacity-50"><Archive size={13} />Archive</button>}
                  {locked && <span className="self-center text-[10px] text-amber-200">Pause before editing rules.</span>}
                </div>
              </article>;
            })}
          </div>}

      {showForm && <div role="presentation" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="campaign-form-title" className="my-4 w-full max-w-4xl rounded-2xl border border-[#2b405e] bg-[#0b1225] p-4 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4"><div><h2 id="campaign-form-title" className="text-lg font-bold">{editing ? 'Edit campaign' : 'New campaign draft'}</h2><p className="mt-1 text-xs text-slate-400">Saving never activates the campaign. Activation is a separate audited action.</p></div><button onClick={closeForm} aria-label="Close campaign form" className="rounded-lg p-2 text-slate-400 hover:bg-white/5"><X size={18} /></button></div>
          {formError && <p role="alert" className="mt-4 rounded-lg border border-rose-300/20 bg-rose-300/5 p-3 text-xs text-rose-200">{formError}</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label><span className={labelClass}>Campaign name</span><input value={form.name} maxLength={100} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} required /></label>
            <label><span className={labelClass}>Campaign type</span><select value={form.campaign_type} onChange={(e) => campaignTypeChange(e.target.value as CampaignType)} className={inputClass}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="md:col-span-2"><span className={labelClass}>Description</span><textarea value={form.description} maxLength={500} rows={2} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} /></label>
            <div><label><span className={labelClass}>Unique code</span><input value={form.code} onChange={(e) => setForm({ ...form, code: normalizeCampaignCode(e.target.value) })} maxLength={40} className={`${inputClass} font-mono uppercase`} autoComplete="off" required /></label><button type="button" onClick={() => void duplicateCode()} className="mt-2 text-xs text-cyan-200 underline underline-offset-2">Generate a code</button></div>
            <div className="grid grid-cols-[1fr_1fr] gap-2"><label><span className={labelClass}>Discount type</span><select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as FormState['discount_type'] })} className={inputClass}><option value="PERCENTAGE">Percent</option><option value="FIXED">Fixed PHP amount</option></select></label><label><span className={labelClass}>Value {form.discount_type === 'PERCENTAGE' ? '(whole %)' : '(PHP)'}</span><input inputMode="decimal" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} className={inputClass} /></label></div>
            <label><span className={labelClass}>Minimum purchase (PHP)</span><input inputMode="decimal" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} className={inputClass} /></label>
            <label><span className={labelClass}>Maximum discount (PHP, optional)</span><input inputMode="decimal" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} className={inputClass} /></label>
            <label><span className={labelClass}>Total redemption limit (blank = no count limit)</span><input type="number" min="1" value={form.total_limit} onChange={(e) => setForm({ ...form, total_limit: e.target.value })} className={inputClass} /></label>
            <label><span className={labelClass}>Per-customer redemption limit (blank = no count limit)</span><input type="number" min="1" value={form.customer_limit} onChange={(e) => setForm({ ...form, customer_limit: e.target.value })} className={inputClass} /></label>
            <label><span className={labelClass}>Total discount budget (PHP)</span><input inputMode="decimal" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={inputClass} required /></label>
            <label><span className={labelClass}>Campaign timezone</span><select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputClass}>{TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
            <label><span className={labelClass}>Starts at ({form.timezone})</span><input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className={inputClass} required /></label>
            <label><span className={labelClass}>Ends at ({form.timezone}, optional)</span><input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className={inputClass} /></label>
            <div className="md:col-span-2 grid gap-3 rounded-xl border border-[#1c2c47] bg-[#081329] p-4 sm:grid-cols-2">
              <label className="flex items-start gap-3 text-xs text-slate-300"><input type="checkbox" checked={form.allow_guest && !['WELCOME', 'CUSTOMER_RETENTION'].includes(form.campaign_type)} disabled={['WELCOME', 'CUSTOMER_RETENTION'].includes(form.campaign_type)} onChange={(e) => setForm({ ...form, allow_guest: e.target.checked })} className="mt-0.5 accent-cyan-300" /><span><b>Allow guest checkout</b><span className="mt-1 block text-[10px] text-slate-500">Guest email is used only for redemption limits; it is not verified customer identity.</span></span></label>
              <label className="flex items-start gap-3 text-xs text-slate-300"><input type="checkbox" checked={form.public_discovery || form.campaign_type === 'PUBLIC_PROMOTION'} disabled={form.campaign_type === 'PUBLIC_PROMOTION' || form.campaign_type === 'PRIVATE_CODE'} onChange={(e) => setForm({ ...form, public_discovery: e.target.checked })} className="mt-0.5 accent-cyan-300" /><span><b>Discoverable on the storefront</b><span className="mt-1 block text-[10px] text-slate-500">Only deliberately public campaigns expose their code. Private codes are never listed.</span></span></label>
              <label><span className={labelClass}>Minimum completed purchases (optional)</span><input type="number" min="0" value={form.min_completed_orders} onChange={(e) => setForm({ ...form, min_completed_orders: e.target.value })} className={inputClass} /></label>
              <label><span className={labelClass}>Maximum completed purchases (optional)</span><input type="number" min="0" value={form.max_completed_orders} onChange={(e) => setForm({ ...form, max_completed_orders: e.target.value })} className={inputClass} /></label>
            </div>
            <fieldset className="md:col-span-2 rounded-xl border border-[#1c2c47] p-3"><legend className="px-1 text-xs font-semibold text-slate-300">Eligible games (none means all games)</legend><div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">{games.map((game) => <label key={game.id} className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.game_ids.includes(game.id)} onChange={() => toggleId('game_ids', game.id)} className="accent-cyan-300" />{game.name}<span className="ml-auto text-[9px] text-slate-500">{game.catalog_status || (game.is_active ? 'ACTIVE' : 'DRAFT')}</span></label>)}</div></fieldset>
            <fieldset className="md:col-span-2 rounded-xl border border-[#1c2c47] p-3"><legend className="px-1 text-xs font-semibold text-slate-300">Eligible packages (none means all packages)</legend><div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">{packages.map((pkg) => <label key={pkg.id} className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.package_ids.includes(pkg.id)} onChange={() => toggleId('package_ids', pkg.id)} className="accent-cyan-300" /><span className="min-w-0 truncate">{pkg.name}</span><span className="ml-auto shrink-0 text-[9px] text-slate-500">{pesos(pkg.price_cents)} · {pkg.catalog_status || (pkg.is_active ? 'ACTIVE' : 'DRAFT')}{pkg.supplier_review_required ? ' · REVIEW' : ''}</span></label>)}</div></fieldset>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[#1b2a45] pt-4 sm:flex-row sm:justify-end"><button onClick={closeForm} className="min-h-11 rounded-xl border border-[#2b405e] px-5 text-sm text-slate-300">Cancel</button><button disabled={saving} onClick={() => void save()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-5 text-sm font-bold text-white disabled:opacity-50">{saving && <Loader2 size={15} className="animate-spin" />}{editing ? 'Save changes' : 'Save draft'}</button></div>
        </section>
      </div>}

      {previewCampaign && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewCampaign(null); }}><section role="dialog" aria-modal="true" aria-labelledby="campaign-preview-title" className="w-full max-w-xl rounded-2xl border border-[#2b405e] bg-[#0b1225] p-5"><div className="flex justify-between"><div><h2 id="campaign-preview-title" className="font-bold">Pricing preview</h2><p className="mt-1 text-xs text-slate-400">Synthetic rules preview only; no real customer record is queried.</p></div><button onClick={() => setPreviewCampaign(null)} aria-label="Close preview"><X size={18} /></button></div><label className="mt-5 block"><span className={labelClass}>Package</span><select value={previewPackageId} onChange={(e) => { setPreviewPackageId(e.target.value); setPreview(null); }} className={inputClass}>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} — {pesos(pkg.price_cents)}</option>)}</select></label><button onClick={() => void runPreview()} disabled={!previewPackageId} className="mt-3 min-h-10 rounded-lg bg-cyan-400/10 px-4 text-xs font-semibold text-cyan-200">Calculate preview</button>{preview && <div className={`mt-4 rounded-xl border p-4 ${preview.valid ? 'border-emerald-300/20 bg-emerald-300/5' : 'border-amber-300/20 bg-amber-300/5'}`}><p className="text-sm font-semibold">{preview.valid ? 'Price is eligible for this synthetic preview' : preview.reason}</p><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><span>Price<br /><b>{pesos(preview.subtotal_cents)}</b></span><span>Discount<br /><b className="text-emerald-200">−{pesos(preview.discount_cents)}</b></span><span>Final<br /><b>{pesos(preview.total_cents)}</b></span></div><p className="mt-3 text-[10px] text-slate-400">New account: {preview.eligible_customer_modes?.new_authenticated ? 'eligible by rules' : 'not eligible'} · returning: {preview.eligible_customer_modes?.returning_authenticated ? 'eligible by rules' : 'not eligible'} · guest: {preview.eligible_customer_modes?.guest ? 'eligible by rules' : 'not eligible'}</p></div>}</section></div>}

      {reportCampaign && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-3 sm:p-6"><section role="dialog" aria-modal="true" aria-labelledby="campaign-report-title" className="my-5 w-full max-w-4xl rounded-2xl border border-[#2b405e] bg-[#0b1225] p-4 sm:p-6"><div className="flex items-start justify-between"><div><h2 id="campaign-report-title" className="font-bold">Campaign report · {reportCampaign.name}</h2><p className="mt-1 text-xs text-slate-400">Database redemption ledger and append-only campaign audit. Customer emails are not included.</p></div><button onClick={() => { setReportCampaign(null); setReport(null); }} aria-label="Close report"><X size={18} /></button></div>{!report ? <div className="p-10 text-center text-slate-400"><Loader2 className="mx-auto animate-spin" /></div> : <><div className="mt-4 grid grid-cols-3 gap-2 text-xs">{[['Reserved', report.summary?.reserved_uses], ['Committed', report.summary?.committed_uses], ['Released', report.summary?.released_uses]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-[#081329] p-3"><span className="text-slate-500">{label}</span><b className="mt-1 block text-base text-slate-100">{value ?? 0}</b></div>)}</div><h3 className="mt-5 text-sm font-semibold">Recent redemptions</h3><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Order</th><th>Status</th><th>State</th><th>Discount</th><th>Reason</th><th>Recorded</th></tr></thead><tbody>{(report.redemptions || []).map((entry, index) => <tr key={String(entry.id || index)} className="border-t border-[#1b2a45]"><td className="p-2 font-mono">{String(entry.reference || '—')}</td><td>{String(entry.order_status || '—')}</td><td>{String(entry.redemption_status || '—')}</td><td>{pesos(Number(entry.discount_cents || 0))}</td><td>{String(entry.release_reason || '—')}</td><td>{String(entry.created_at || '—')}</td></tr>)}</tbody></table></div><h3 className="mt-5 text-sm font-semibold">Audit history</h3><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{(report.audit || []).map((entry, index) => <div key={String(entry.id || index)} className="rounded-lg bg-[#081329] p-3 text-[10px] text-slate-400"><b className="text-slate-200">{String(entry.action)}</b> · actor {String(entry.actor_id)} · {String(entry.created_at)}<pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(entry.after_state)}</pre></div>)}</div></>}</section></div>}
    </div>
  );
}

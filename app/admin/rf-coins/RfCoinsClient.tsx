'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertTriangle, Search, ChevronLeft, ChevronRight, RefreshCw, Download, ShieldAlert } from 'lucide-react';
import { formatCoinPrice, type RfCoinPackage } from '@/lib/rfCoins';

type Settings = {
  enabled: boolean;
  topups_enabled: boolean;
  spending_enabled: boolean;
  centavos_per_coin: number;
  high_value_adjustment_coins: number;
  max_daily_admin_adjustments: number;
  database_topups_enabled: boolean;
  database_spending_enabled: boolean;
  funding_release_locked: boolean;
  spending_release_locked: boolean;
};

type WalletRow = {
  user_id: string;
  email: string;
  balance_coins: number | string;
  total_purchased_coins: number | string;
  total_spent_coins: number | string;
  total_manual_credited_coins: number | string;
  total_manual_debited_coins: number | string;
  total_reversed_coins: number | string;
  created_at: string;
  updated_at: string;
};

type TopupRow = {
  id: string;
  user_id: string;
  email: string;
  package_id: string | null;
  package_name: string | null;
  coins: number;
  bonus_coins: number;
  price_cents: number;
  status: string;
  provider: string;
  provider_reference: string | null;
  payment_verified_at: string | null;
  credited_at: string | null;
  credited_total: number | string;
  reversed_total: number | string;
  created_at: string;
  updated_at: string;
};

type RequestRow = {
  id: string;
  target_user_id: string;
  target_email?: string;
  direction: string;
  amount_coins: number;
  reason: string;
  category: string;
  status: string;
  requested_by_email: string;
  approved_by_email: string | null;
  is_high_value: boolean;
  created_at: string;
};

type AuditRow = {
  id: string;
  actor_admin_email: string;
  action: string;
  target_user_id: string | null;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

type LedgerRow = {
  id: string;
  wallet_user_id: string;
  email?: string;
  direction: string;
  amount_coins: number | string;
  kind: string;
  balance_after: number | string;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  created_at: string;
};

type ExceptionRow = {
  alert_key: string;
  severity: 'critical' | 'high' | 'medium';
  category: string;
  entity_type: string;
  entity_id: string;
  target_user_id: string | null;
  summary: string;
  occurred_at: string;
};

type ApiData = {
  settings: Settings | null;
  wallets: WalletRow[];
  topups: TopupRow[];
  packages: RfCoinPackage[];
  adjustmentRequests: RequestRow[];
  audit: AuditRow[];
  ledger: LedgerRow[];
  exceptions: ExceptionRow[];
  trend: Array<{ day: string; funded: number | string | null; spent: number | string | null; reversed: number | string | null; manual_credits: number | string | null; manual_debits: number | string | null }>;
  topupTrend: Array<{ day: string; status: string; count: number | string; price_cents: number | string }>;
  walletDistribution: Array<{ bucket: string; wallets: number | string }>;
  pendingAging: Array<{ age: string; count: number | string; price_cents: number | string }>;
  pagination: {
    page: number; pageSize: number; totalWallets: number; totalTopups: number;
    totalLedger: number; totalAdjustmentRequests: number; totalPackages: number; totalAudit: number; totalExceptions: number;
  };
  metrics: {
    outstanding: number | string; walletCount: number | string; purchased: number | string;
    spent: number | string; manualCredited: number | string; manualDebited: number | string;
    reversed: number | string; pendingTopups: number | string; pendingTopupCents: number | string;
    failedExpiredTopups: number | string; pendingAdjustments: number | string;
    duplicateProviderReferences: number | string; duplicatePaymentSessions: number | string;
    duplicateCreditAttempts: number | string; paidTopupsMissingPaymentSession: number | string;
    paymentAmountMismatches: number | string;
    ledgerBalanceDiscrepancies: number | string; unresolvedExceptions: number | string;
  };
};

const TABS = ['Overview', 'Customer Wallets', 'Coin Top-Ups', 'Wallet Transactions', 'Manual Adjustments', 'Coin Packages', 'Wallet Settings', 'Audit Logs', 'Exceptions & Alerts'] as const;
type Tab = (typeof TABS)[number];

function displayCoins(value: number | string): string {
  try {
    const exact = typeof value === 'number' ? BigInt(Math.trunc(value)) : BigInt(value);
    return exact.toLocaleString('en-PH');
  } catch {
    return 'Unavailable';
  }
}

function displayCentavos(value: number | string): string {
  try {
    const cents = typeof value === 'number' ? BigInt(Math.trunc(value)) : BigInt(value);
    const pesos = cents / BigInt(100);
    const centavos = String(cents % BigInt(100)).padStart(2, '0');
    return `₱${pesos.toLocaleString('en-PH')}.${centavos}`;
  } catch {
    return 'Unavailable';
  }
}

export default function RfCoinsClient() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<'24h' | '7d' | '30d' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [walletStatus, setWalletStatus] = useState<'all' | 'zero' | 'nonzero'>('all');
  const [topupStatus, setTopupStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ payload: Record<string, unknown>; message: string } | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const confirmationTriggerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const to = new Date();
      const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : 24 * 30;
      const fromValue = period === 'custom' ? new Date(`${customFrom}T00:00:00.000Z`) : new Date(to.getTime() - hours * 60 * 60 * 1000);
      const toValue = period === 'custom'
        ? new Date(new Date(`${customTo}T00:00:00.000Z`).getTime() + 86400000)
        : to;
      if (!Number.isFinite(fromValue.getTime()) || !Number.isFinite(toValue.getTime()) || fromValue >= toValue) {
        setActionMsg('Choose valid custom UTC dates.');
        setLoading(false);
        return;
      }
      const params = new URLSearchParams({ page: String(page), from: fromValue.toISOString(), to: toValue.toISOString(), wallet_status: walletStatus });
      if (search) params.set('search', search);
      if (selectedWallet) params.set('wallet_id', selectedWallet);
      if (topupStatus) params.set('topup_status', topupStatus);
      if (provider) params.set('provider', provider);
      const res = await fetch(`/api/admin/rf-coins?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => null) as (ApiData & { error?: string; guidance?: string }) | null;
      if (!res.ok || !json) {
        setError(json?.guidance ? `${json.error} ${json.guidance}` : json?.error || 'Could not load RF Coins data.');
        return;
      }
      setData(json);
      setError('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo, page, period, provider, search, selectedWallet, topupStatus, walletStatus]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!pendingConfirmation) {
      const trigger = confirmationTriggerRef.current;
      confirmationTriggerRef.current = null;
      if (trigger?.isConnected) trigger.focus();
      return;
    }

    const dialog = document.querySelector<HTMLElement>('[data-rf-coin-confirm]');
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ));
    focusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingConfirmation(null);
        setConfirmationText('');
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pendingConfirmation]);

  const post = async (payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText) {
      confirmationTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingConfirmation({ payload, message: confirmText });
      setConfirmationText('');
      return;
    }
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/rf-coins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; error?: string; status?: string } | null;
      if (!res.ok || !json?.ok) {
        setActionMsg(json?.error || 'Action failed.');
        return;
      }
      setActionMsg(json.status ? `Done. Status: ${json.status}` : 'Done.');
      await load();
    } catch {
      setActionMsg('Could not reach the server.');
    }
  };

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="animate-spin text-cyan-300" size={28} /></div>;
  }
  if (error || !data) {
    return (
      <div role="status" className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-6 text-sm text-amber-200">
        <AlertTriangle size={16} className="mr-2 inline" />
        {error || 'RF Coins has not been configured for this environment.'}
        <p className="mt-2 text-xs leading-5 text-slate-400">No balances or totals are inferred. Review the canonical RF Coins migrations in a disposable database first; schema deployment does not enable funding or spending.</p>
        <button type="button" onClick={() => { setError(''); setLoading(true); void load(); }} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300/30 px-3 text-xs font-semibold hover:bg-amber-300/10"><RefreshCw size={14} /> Retry</button>
      </div>
    );
  }

  const s = data.settings;
  const fmtDate = (v: string) => new Date(v).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  const activeTotal = tab === 'Customer Wallets' ? data.pagination.totalWallets
    : tab === 'Coin Top-Ups' ? data.pagination.totalTopups
      : tab === 'Wallet Transactions' ? data.pagination.totalLedger
        : tab === 'Manual Adjustments' ? data.pagination.totalAdjustmentRequests
          : tab === 'Coin Packages' ? data.pagination.totalPackages
          : tab === 'Audit Logs' ? data.pagination.totalAudit
            : tab === 'Exceptions & Alerts' ? data.pagination.totalExceptions : 0;
  const pageCount = Math.max(1, Math.ceil(activeTotal / data.pagination.pageSize));
  const exportType = tab === 'Customer Wallets' ? 'wallets'
    : tab === 'Coin Top-Ups' ? 'topups'
      : tab === 'Wallet Transactions' ? 'ledger'
        : tab === 'Manual Adjustments' ? 'adjustments'
          : tab === 'Audit Logs' ? 'audit'
            : tab === 'Exceptions & Alerts' ? 'exceptions' : null;
  const exportHref = (() => {
    if (!exportType) return null;
    const now = new Date();
    const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : 24 * 30;
    const from = period === 'custom' ? new Date(`${customFrom}T00:00:00.000Z`) : new Date(now.getTime() - hours * 60 * 60 * 1000);
    const to = period === 'custom' ? new Date(new Date(`${customTo}T00:00:00.000Z`).getTime() + 86400000) : now;
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) return null;
    const params = new URLSearchParams({ export: exportType, from: from.toISOString(), to: to.toISOString() });
    if (search) params.set('search', search);
    if (selectedWallet) params.set('wallet_id', selectedWallet);
    if (tab === 'Customer Wallets') params.set('wallet_status', walletStatus);
    if (tab === 'Coin Top-Ups') {
      if (topupStatus) params.set('topup_status', topupStatus);
      if (provider) params.set('provider', provider);
    }
    return `/api/admin/rf-coins?${params.toString()}`;
  })();

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="RF Coins admin sections" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => { setTab(t); setPage(1); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === t ? 'bg-gradient-to-r from-blue-500 to-violet-600 text-white' : 'border border-[#22314d] text-slate-300 hover:border-cyan-400'}`}>
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSelectedWallet(null); setSearch(searchDraft.trim()); }} className="flex flex-col gap-3 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-300">Search customer, wallet, transaction or audit reference
          <span className="mt-1 flex min-h-10 items-center gap-2 rounded-lg border border-[#22314d] bg-[#070d1c] px-3 focus-within:border-cyan-400"><Search size={15} className="shrink-0 text-slate-500" /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" placeholder="Email, UUID or reference" /></span>
        </label>
        <label className="text-xs font-medium text-slate-300">Trend range
          <select value={period} onChange={(event) => { setPeriod(event.target.value as typeof period); setPage(1); }} className="mt-1 block min-h-10 rounded-lg border border-[#22314d] bg-[#070d1c] px-3 text-sm text-white">
            <option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="custom">Custom UTC dates</option>
          </select>
        </label>
        {period === 'custom' && <><label className="text-xs font-medium text-slate-300">From (UTC)<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-[#22314d] bg-[#070d1c] px-2 text-sm text-white" /></label><label className="text-xs font-medium text-slate-300">Through (UTC)<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-[#22314d] bg-[#070d1c] px-2 text-sm text-white" /></label></>}
        {tab === 'Customer Wallets' && <label className="text-xs font-medium text-slate-300">Balance<select value={walletStatus} onChange={(event) => { setWalletStatus(event.target.value as typeof walletStatus); setPage(1); }} className="mt-1 block min-h-10 rounded-lg border border-[#22314d] bg-[#070d1c] px-3 text-sm text-white"><option value="all">All wallets</option><option value="zero">Zero RF</option><option value="nonzero">Nonzero RF</option></select></label>}
        {tab === 'Coin Top-Ups' && <>
          <label className="text-xs font-medium text-slate-300">Status<select value={topupStatus} onChange={(event) => { setTopupStatus(event.target.value); setPage(1); }} className="mt-1 block min-h-10 rounded-lg border border-[#22314d] bg-[#070d1c] px-3 text-sm text-white"><option value="">All statuses</option>{['PENDING','PAID','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED'].map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-300">Provider key<input value={provider} onChange={(event) => { setProvider(event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)); setPage(1); }} maxLength={60} placeholder="Any provider" className="mt-1 block min-h-10 w-36 rounded-lg border border-[#22314d] bg-[#070d1c] px-3 text-sm text-white" /></label>
        </>}
        <button type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 text-xs font-semibold text-slate-950 hover:bg-cyan-300">Search</button>
        <button type="button" aria-label="Refresh RF Coins report" onClick={() => { setLoading(true); void load(); }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#22314d] px-3 text-xs text-slate-200 hover:border-cyan-400"><RefreshCw size={14} /> Refresh</button>
        {exportHref && <a href={exportHref} download className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-cyan-300/25 px-3 text-xs font-semibold text-cyan-200 hover:bg-cyan-300/10"><Download size={14} /> Export CSV</a>}
      </form>

      {actionMsg && <p className="rounded-lg border border-[#1b2a45] bg-[#0b1225] p-3 text-xs text-slate-200">{actionMsg}</p>}

      {tab === 'Overview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-3 py-1.5 ${s?.enabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-500/10 text-slate-400'}`}>Database feature switch: {s?.enabled ? 'on' : 'off'}</span>
            <span className="rounded-full bg-rose-400/10 px-3 py-1.5 text-rose-200">Funding: release locked</span>
            <span className="rounded-full bg-rose-400/10 px-3 py-1.5 text-rose-200">Spending: release locked</span>
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              ['Outstanding RF Coins', displayCoins(data.metrics.outstanding), 'Customer wallet liability; not cash or revenue'],
              ['Initialized wallets', displayCoins(data.metrics.walletCount), 'Customer wallets with a stored balance'],
              ['Coins purchased', displayCoins(data.metrics.purchased), 'Lifetime coin units recorded'],
              ['Coins spent', displayCoins(data.metrics.spent), 'Lifetime coin units recorded'],
              ['Manual credits', displayCoins(data.metrics.manualCredited), 'Audited coin units'],
              ['Manual debits', displayCoins(data.metrics.manualDebited), 'Audited coin units'],
              ['Refunds / reversals', displayCoins(data.metrics.reversed), 'Reversed coin units'],
              ['Pending top-ups', `${displayCoins(data.metrics.pendingTopups)} · ${displayCentavos(data.metrics.pendingTopupCents)}`, 'Count · PHP amount; not confirmed revenue'],
              ['Failed / expired top-ups', displayCoins(data.metrics.failedExpiredTopups), 'All recorded statuses'],
              ['Payment amount mismatches', displayCoins(data.metrics.paymentAmountMismatches), 'Provider amount, currency, or reference differs'],
              ['Duplicate provider references', displayCoins(data.metrics.duplicateProviderReferences), 'Must be investigated before settlement'],
              ['Duplicate credit attempts', displayCoins(data.metrics.duplicateCreditAttempts), 'More than one top-up credit ledger row'],
              ['Duplicate payment sessions', displayCoins(data.metrics.duplicatePaymentSessions), 'More than one create session for a top-up'],
              ['Paid top-ups missing payment session', displayCoins(data.metrics.paidTopupsMissingPaymentSession), 'Provider settlement evidence link is absent'],
              ['Pending adjustments', displayCoins(data.metrics.pendingAdjustments), 'Awaiting a distinct Super Admin where required'],
              ['Wallet/ledger discrepancies', displayCoins(data.metrics.ledgerBalanceDiscrepancies), 'Stored balance differs from immutable ledger total'],
              ['Known ledger exceptions', displayCoins(data.metrics.unresolvedExceptions), 'Local consistency checks only; not provider reconciliation'],
            ].map(([label, value, detail]) => (
              <div key={String(label)} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="font-display mt-1 break-words text-lg font-bold text-cyan-300">{value}</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h2 className="text-sm font-semibold text-slate-100">Wallet activity</h2><p className="mt-1 text-xs text-slate-500">UTC ledger units by day. Funding, spending, reversals, and manual actions are not PHP revenue.</p>
              {data.trend.length ? <div className="mt-4 space-y-3">{data.trend.slice(-14).map((day) => <div key={day.day} className="border-b border-[#17243a] pb-2"><time className="text-[10px] text-slate-500">{day.day} UTC</time><div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]"><span className="text-cyan-200">Funded {displayCoins(day.funded || 0)}</span><span className="text-violet-200">Spent {displayCoins(day.spent || 0)}</span><span className="text-amber-200">Reversed {displayCoins(day.reversed || 0)}</span><span className="text-emerald-200">Manual +{displayCoins(day.manual_credits || 0)} / −{displayCoins(day.manual_debits || 0)}</span></div></div>)}</div> : <p className="mt-4 text-xs text-slate-500">No ledger activity in this range.</p>}
            </section>
            <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h2 className="text-sm font-semibold text-slate-100">Wallet balance distribution</h2><p className="mt-1 text-xs text-slate-500">Current customer wallet counts by exact balance band.</p>
              <div className="mt-4 space-y-3">{data.walletDistribution.map((bucket) => { const count = Number(bucket.wallets); const max = Math.max(1, ...data.walletDistribution.map((item) => Number(item.wallets))); return <div key={bucket.bucket} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-3 text-xs"><span className="text-slate-400">{bucket.bucket}</span><span className="h-2 overflow-hidden rounded-full bg-[#17243a]"><span className="block h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, count / max * 100))}%` }} /></span><span className="text-right text-slate-200">{displayCoins(bucket.wallets)}</span></div>; })}</div>
            </section>
            <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h2 className="text-sm font-semibold text-slate-100">Top-up status trend</h2><p className="mt-1 text-xs text-slate-500">Created top-up records and their saved PHP price snapshots. Not provider settlement proof.</p>
              {data.topupTrend.length ? <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{data.topupTrend.slice(-50).map((row) => <div key={`${row.day}-${row.status}`} className="flex flex-wrap justify-between gap-2 border-b border-[#17243a] py-2 text-xs"><span className="text-slate-300">{row.day} UTC · {row.status}</span><span className="text-slate-200">{displayCoins(row.count)} · {displayCentavos(row.price_cents)}</span></div>)}</div> : <p className="mt-4 text-xs text-slate-500">No top-ups in this range.</p>}
            </section>
            <section className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
              <h2 className="text-sm font-semibold text-slate-100">Pending payment aging</h2><p className="mt-1 text-xs text-slate-500">Outstanding records by age; this does not assert that a provider has not settled externally.</p>
              <div className="mt-3 space-y-2">{data.pendingAging.map((bucket) => <div key={bucket.age} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[#070d1c] px-3 py-2 text-xs"><span className="text-slate-300">{bucket.age}</span><span className="text-amber-200">{displayCoins(bucket.count)} · {displayCentavos(bucket.price_cents)}</span></div>)}</div>
              <div className="mt-4 flex flex-wrap gap-3 text-xs"><Link className="text-cyan-300 hover:text-cyan-200" href="/admin/reconciliation">Open reconciliation</Link><Link className="text-cyan-300 hover:text-cyan-200" href="/admin/refunds">Open refunds</Link></div>
            </section>
          </div>
          {Number(data.metrics.unresolvedExceptions) > 0 && <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/5 p-4 text-xs text-rose-200">Known local wallet/top-up consistency exceptions need investigation. Provider reconciliation data is not available from the staged wallet schema; no settlement status is changed here.</div>}
          <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
            <p className="text-xs text-slate-400">Recent audit entries</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {data.audit.slice(0, 5).map((a) => (
                <li key={a.id}>{fmtDate(a.created_at)} · {a.actor_admin_email} · {a.action}</li>
              ))}
              {data.audit.length === 0 && <li className="text-slate-500">No audit entries yet.</li>}
            </ul>
          </div>
        </div>
      )}

      {tab === 'Customer Wallets' && (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Purchased</th><th className="p-3 font-medium">Spent</th><th className="p-3 font-medium">Manual + / −</th><th className="p-3 font-medium">Reversed</th><th className="p-3 font-medium">Updated</th><th className="p-3 font-medium">Details</th>
            </tr></thead>
            <tbody>
              {data.wallets.map((w) => (
                <tr key={w.user_id} className="border-b border-[#0f1b31]">
                  <td className="p-3"><span className="block text-slate-100">{w.email}</span><span className="font-mono text-[10px] text-slate-500">{w.user_id}</span></td>
                  <td className="p-3 font-bold text-cyan-200">{displayCoins(w.balance_coins)} RF</td>
                  <td className="p-3">{displayCoins(w.total_purchased_coins)}</td>
                  <td className="p-3">{displayCoins(w.total_spent_coins)}</td>
                  <td className="p-3"><span className="text-emerald-300">+{displayCoins(w.total_manual_credited_coins)}</span><span className="text-slate-500"> / </span><span className="text-rose-300">−{displayCoins(w.total_manual_debited_coins)}</span></td>
                  <td className="p-3">{displayCoins(w.total_reversed_coins)}</td>
                  <td className="p-3">{fmtDate(w.updated_at)}</td>
                  <td className="p-3"><button type="button" onClick={() => { setSelectedWallet(w.user_id); setPage(1); setTab('Wallet Transactions'); }} className="min-h-9 rounded-lg border border-cyan-300/25 px-3 text-cyan-200 hover:bg-cyan-300/10">Inspect</button></td>
                </tr>
              ))}
              {data.wallets.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={8}>No matching wallets.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Coin Top-Ups' && (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Reference / Customer</th><th className="p-3 font-medium">Coins</th><th className="p-3 font-medium">PHP snapshot</th><th className="p-3 font-medium">Provider</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Credit / reversal</th><th className="p-3 font-medium">Created / updated</th>
            </tr></thead>
            <tbody>
              {data.topups.map((t) => (
                <tr key={t.id} className="border-b border-[#0f1b31]">
                  <td className="p-3"><span className="block font-mono text-[10px] text-cyan-200">{t.id}</span><span className="block text-slate-300">{t.email}</span><span className="block text-[10px] text-slate-500">{t.package_name || 'Package unavailable'}</span>{t.provider_reference && <span className="block font-mono text-[10px] text-slate-500">Provider ref: {t.provider_reference}</span>}</td>
                  <td className="p-3 font-bold">{displayCoins(t.coins)} + {displayCoins(t.bonus_coins)} bonus</td>
                  <td className="p-3">{formatCoinPrice(t.price_cents)}</td>
                  <td className="p-3">{t.provider}</td>
                  <td className="p-3"><span className="rounded-full bg-slate-500/10 px-2 py-1">{t.status}</span></td>
                  <td className="p-3">Verified: {t.payment_verified_at ? fmtDate(t.payment_verified_at) : '—'}<br />Credited: {t.credited_at ? fmtDate(t.credited_at) : '—'}<br />Reversed: {displayCoins(t.reversed_total)}</td>
                  <td className="p-3">{fmtDate(t.created_at)}<br /><span className="text-slate-500">{fmtDate(t.updated_at)}</span></td>
                </tr>
              ))}
              {data.topups.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={7}>No matching top-ups.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Wallet Transactions' && (
        <div className="space-y-3">
        {selectedWallet && data.wallets[0] && <section aria-label="Wallet details" className="rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-cyan-200">Customer wallet</p><h2 className="mt-1 break-all text-sm font-semibold text-slate-100">{data.wallets[0].email}</h2><p className="mt-1 font-mono text-[10px] text-slate-500">{data.wallets[0].user_id}</p><p className="mt-3 text-xl font-bold text-cyan-200">{displayCoins(data.wallets[0].balance_coins)} RF</p><p className="mt-1 text-xs text-slate-400">Created {fmtDate(data.wallets[0].created_at)} · Updated {fmtDate(data.wallets[0].updated_at)}</p></div><button type="button" onClick={() => { setSelectedWallet(null); setPage(1); }} className="min-h-9 rounded-lg border border-[#22314d] px-3 text-xs text-slate-200">Clear wallet filter</button></div><p className="mt-3 text-xs text-slate-400">Lifetime purchased {displayCoins(data.wallets[0].total_purchased_coins)} · spent {displayCoins(data.wallets[0].total_spent_coins)} · manual +{displayCoins(data.wallets[0].total_manual_credited_coins)} / −{displayCoins(data.wallets[0].total_manual_debited_coins)} · reversed {displayCoins(data.wallets[0].total_reversed_coins)}</p></section>}
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Movement</th><th className="p-3 font-medium">Kind / reference</th><th className="p-3 font-medium">Balance after</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">UTC timestamp</th>
            </tr></thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr key={l.id} className="border-b border-[#0f1b31]">
                  <td className="p-3"><span className="block text-slate-200">{l.email}</span><span className="font-mono text-[10px] text-slate-500">{l.wallet_user_id}</span></td>
                  <td className={`p-3 font-bold ${l.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {l.direction === 'credit' ? '+' : '−'}{displayCoins(l.amount_coins)} RF
                  </td>
                  <td className="p-3">{l.kind}<br /><span className="font-mono text-[10px] text-slate-500">{l.reference_type || '—'} · {l.reference_id || '—'}</span></td>
                  <td className="p-3">{displayCoins(l.balance_after)} RF</td>
                  <td className="p-3 max-w-[200px] truncate">{l.reason || '—'}</td>
                  <td className="p-3">{fmtDate(l.created_at)}</td>
                </tr>
              ))}
              {data.ledger.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No matching wallet transactions.</td></tr>}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {tab === 'Manual Adjustments' && (
        <ManualAdjustments
          onAction={post}
          requests={data.adjustmentRequests}
        />
      )}

      {tab === 'Coin Packages' && (
        <PackagesPanel packages={data.packages} onAction={post} />
      )}

      {tab === 'Wallet Settings' && (
        <SettingsPanel settings={s} onAction={post} />
      )}

      {tab === 'Audit Logs' && (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Admin</th><th className="p-3 font-medium">Action</th><th className="p-3 font-medium">Target</th><th className="p-3 font-medium">Details</th>
            </tr></thead>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id} className="border-b border-[#0f1b31]">
                  <td className="p-3">{fmtDate(a.created_at)}</td>
                  <td className="p-3">{a.actor_admin_email}</td>
                  <td className="p-3">{a.action}</td>
                  <td className="p-3 font-mono text-[10px]">{a.target_user_id || '—'}</td>
                  <td className="p-3 max-w-[280px] truncate font-mono text-[10px]">{JSON.stringify(a.details)}</td>
                </tr>
              ))}
              {data.audit.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>No audit entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Exceptions & Alerts' && (
        <section aria-label="RF Coins accounting alerts" className="space-y-3">
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-5 text-amber-100">
            <p className="font-semibold">Read-only accounting exceptions · {data.pagination.totalExceptions.toLocaleString('en-PH')} in this range</p>
            <p className="mt-1 text-amber-100/70">These deduplicated alerts are derived from current ledger and settlement records. They never credit, debit, refund, or change payment status automatically. Provider settlement still requires independent verification.</p>
            <nav aria-label="Related admin monitoring" className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <Link href="/admin/notifications" className="text-cyan-200 underline underline-offset-2">Notifications</Link>
              <Link href="/admin/risk-alerts" className="text-cyan-200 underline underline-offset-2">Risk alerts</Link>
              <Link href="/admin/activity-log" className="text-cyan-200 underline underline-offset-2">Activity log</Link>
              <Link href="/admin/system-health" className="text-cyan-200 underline underline-offset-2">System health</Link>
            </nav>
          </div>
          <div className="space-y-2">
            {data.exceptions.map((item) => (
              <article key={item.alert_key} className="flex min-w-0 flex-col gap-2 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <ShieldAlert aria-hidden="true" size={16} className={`mt-0.5 shrink-0 ${item.severity === 'critical' ? 'text-rose-300' : item.severity === 'high' ? 'text-amber-300' : 'text-slate-300'}`} />
                  <div className="min-w-0"><p className="break-words text-sm font-medium text-slate-100">{item.summary}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{item.category} · {item.entity_type} · {item.entity_id}</p>{item.target_user_id && <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Customer {item.target_user_id}</p>}</div>
                </div>
                <time className="shrink-0 text-[10px] text-slate-500">{fmtDate(item.occurred_at)}</time>
              </article>
            ))}
            {data.exceptions.length === 0 && <p className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 p-4 text-sm text-emerald-200">No derived RF Coins exceptions in this reporting range.</p>}
          </div>
        </section>
      )}

      {tab !== 'Overview' && <nav aria-label={`${tab} pages`} className="flex items-center justify-between rounded-xl border border-[#1b2a45] bg-[#0b1225] px-3 py-2">
        <p className="text-xs text-slate-400">Page {page} of {pageCount} · {activeTotal.toLocaleString('en-PH')} records</p>
        <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#22314d] px-3 text-xs disabled:opacity-40"><ChevronLeft size={14} /> Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#22314d] px-3 text-xs disabled:opacity-40">Next <ChevronRight size={14} /></button></div>
      </nav>}

      {pendingConfirmation && <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingConfirmation(null); }}>
        <section data-rf-coin-confirm role="dialog" aria-modal="true" aria-labelledby="rf-coin-confirm-title" aria-describedby="rf-coin-confirm-message" tabIndex={-1} className="w-full max-w-md rounded-2xl border border-amber-300/25 bg-[#0b1225] p-5 shadow-2xl">
          <h2 id="rf-coin-confirm-title" className="text-base font-semibold text-slate-100">Confirm financial operation</h2>
          <p id="rf-coin-confirm-message" className="mt-2 text-sm leading-6 text-slate-300">{pendingConfirmation.message}</p>
          <label className="mt-4 block text-xs font-medium text-slate-300">Type CONFIRM to continue<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className={`${inputCls} mt-1`} /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setPendingConfirmation(null); setConfirmationText(''); }} className="min-h-10 rounded-lg border border-[#22314d] px-4 text-xs">Cancel</button><button type="button" disabled={confirmationText !== 'CONFIRM'} onClick={() => { const current = pendingConfirmation; setPendingConfirmation(null); setConfirmationText(''); if (current) void post(current.payload); }} className="min-h-10 rounded-lg bg-amber-300 px-4 text-xs font-bold text-slate-950 disabled:opacity-40">Confirm action</button></div>
        </section>
      </div>}
    </div>
  );
}

type PostFn = (payload: Record<string, unknown>, confirmText?: string) => Promise<void>;

const inputCls = 'w-full rounded-lg border border-[#22314d] bg-[#070d1c] px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400';

function ManualAdjustments({ requests, onAction }: { requests: RequestRow[]; onAction: PostFn }) {
  const [userId, setUserId] = useState('');
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('correction');

  const submit = () => {
    if (!userId || !amount || !reason) return;
    onAction({
      action: 'adjustment',
      target_user_id: userId,
      direction,
      amount_coins: Number(amount),
      reason,
      category,
      idempotency_key: `rf-coin-adjust-${crypto.randomUUID()}`,
    }, `Issue ${direction === 'credit' ? 'credit to' : 'debit from'} customer ${userId} of ${amount} RF Coins? This is logged permanently.`);
    setAmount('');
    setReason('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
        <p className="text-xs font-semibold text-slate-200">Manual wallet adjustment</p>
        <p className="mt-1 text-[11px] text-slate-400">Credits/debits are permanent ledger entries. High-value adjustments (at or above the configured threshold) require approval by a second Super Admin.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">Customer Auth UUID<input aria-label="Customer Auth UUID" className={`${inputCls} mt-1`} placeholder="UUID" value={userId} onChange={(e) => setUserId(e.target.value.trim())} /></label>
          <label className="text-xs text-slate-400">Direction<select aria-label="Adjustment direction" className={`${inputCls} mt-1`} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="credit">Credit (add coins)</option>
            <option value="debit">Debit (remove coins)</option>
          </select></label>
          <label className="text-xs text-slate-400">Amount in RF Coins<input aria-label="Adjustment amount in RF Coins" className={`${inputCls} mt-1`} placeholder="Positive whole coins" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} /></label>
          <label className="text-xs text-slate-400">Category<select aria-label="Adjustment category" className={`${inputCls} mt-1`} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="compensation">Compensation</option>
            <option value="correction">Correction</option>
            <option value="promotion">Promotion</option>
          </select></label>
          <label className="text-xs text-slate-400 sm:col-span-2">Reason (recorded in the ledger and immutable audit)<input aria-label="Adjustment reason" maxLength={1000} className={`${inputCls} mt-1`} placeholder="Required operational reason" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </div>
        <button type="button" onClick={submit} disabled={!userId || !Number(amount) || Number(amount) > 1000000 || reason.trim().length < 3}
          className="mt-3 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Submit adjustment
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
            <th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Change</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Actions</th>
          </tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-[#0f1b31]">
                <td className="p-3">{new Date(r.created_at).toLocaleString('en-PH')}</td>
                <td className="p-3"><span className="block text-slate-200">{r.target_email}</span><span className="font-mono text-[10px] text-cyan-300">{r.target_user_id}</span><span className="block text-[10px] text-slate-500">Requested by {r.requested_by_email}</span>{r.approved_by_email && <span className="block text-[10px] text-emerald-300">Reviewed by {r.approved_by_email}</span>}</td>
                <td className={`p-3 font-bold ${r.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {r.direction === 'credit' ? '+' : '−'}{displayCoins(r.amount_coins)}
                </td>
                <td className="p-3 max-w-[220px] truncate">{r.reason}</td>
                <td className="p-3">
                  {r.status}
                  {r.is_high_value && <span className="ml-1 text-amber-300">(high value)</span>}
                </td>
                <td className="p-3">
                  {r.status === 'PENDING' && (
                    <span className="flex gap-2">
                      <button type="button" onClick={() => onAction({ action: 'decide', request_id: r.id, approve: true }, `Approve ${r.direction} of ${displayCoins(r.amount_coins)} RF for ${r.target_email || r.target_user_id}. The database requires a different active Super Admin for high-value approval.`)}
                        className="rounded border border-emerald-400/40 px-2 py-1 text-emerald-300 hover:bg-emerald-400/10">Approve</button>
                      <button type="button" onClick={() => onAction({ action: 'decide', request_id: r.id, approve: false }, `Reject this ${r.direction} request?`)}
                        className="rounded border border-rose-400/40 px-2 py-1 text-rose-300 hover:bg-rose-400/10">Reject</button>
                    </span>
                  )}
                  {r.status !== 'PENDING' && <span className="text-slate-500">{r.approved_by_email || '—'}</span>}
                </td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No adjustment requests yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PackagesPanel({ packages, onAction }: { packages: RfCoinPackage[]; onAction: PostFn }) {
  const [editing, setEditing] = useState<RfCoinPackage | null>(null);
  const [name, setName] = useState('');
  const [coins, setCoins] = useState('');
  const [bonus, setBonus] = useState('');
  const [priceCents, setPriceCents] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  const reset = () => { setEditing(null); setName(''); setCoins(''); setBonus(''); setPriceCents(''); setSortOrder('0'); };
  const beginEdit = (pkg: RfCoinPackage) => {
    setEditing(pkg); setName(pkg.name); setCoins(String(pkg.coins)); setBonus(String(pkg.bonus_coins));
    setPriceCents(String(pkg.price_cents)); setSortOrder(String(pkg.sort_order));
  };

  const submit = () => {
    const parsedCoins = Number(coins);
    const parsedBonus = Number(bonus || '0');
    const parsedPrice = Number(priceCents);
    if (name.trim().length < 2 || name.trim().length > 80 || !Number.isSafeInteger(parsedCoins) || parsedCoins < 1
      || !Number.isSafeInteger(parsedBonus) || parsedBonus < 0 || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1) return;
    onAction({
      action: 'package',
      package_id: editing?.id,
      name: name.trim(), coins: parsedCoins, bonus_coins: parsedBonus,
      price_cents: parsedPrice, is_active: editing?.is_active ?? false,
      sort_order: Number(sortOrder),
    }, editing
      ? `Save package “${editing.name}” as ${parsedCoins} + ${parsedBonus} bonus coins at ${formatCoinPrice(parsedPrice)}? Existing top-up snapshots will not change.`
      : `Create inactive package “${name.trim()}” (${parsedCoins} + ${parsedBonus} bonus coins at ${formatCoinPrice(parsedPrice)})? It will not be purchasable until separately activated and the funding release gate is approved.`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
        <p className="text-xs font-semibold text-slate-200">{editing ? `Edit package · ${editing.id}` : 'Create funding package'}</p>
        <p className="mt-1 text-[11px] text-slate-500">Money is stored as integer centavos. Package edits never rewrite existing top-up snapshots; new packages start inactive.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs text-slate-400">Package name<input aria-label="Package name" maxLength={80} className={`${inputCls} mt-1`} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="text-xs text-slate-400">Coin units<input aria-label="Package coins" className={`${inputCls} mt-1`} placeholder="Coins" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} /></label>
          <label className="text-xs text-slate-400">Bonus coins<input aria-label="Package bonus coins" className={`${inputCls} mt-1`} placeholder="Bonus" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))} /></label>
          <label className="text-xs text-slate-400">Price (centavos)<input aria-label="Package price in centavos" className={`${inputCls} mt-1`} placeholder="e.g. 10000" inputMode="numeric" value={priceCents} onChange={(e) => setPriceCents(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} /></label>
          <label className="text-xs text-slate-400">Display order<input aria-label="Package display order" className={`${inputCls} mt-1`} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} /></label>
        </div>
        <button type="button" onClick={submit} disabled={name.trim().length < 2 || !Number(coins) || !priceCents || Number(priceCents) > 100000000}
          className="mt-3 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {editing ? 'Save package' : 'Create inactive package'}
        </button>
        {editing && <button type="button" onClick={reset} className="ml-2 min-h-9 rounded-lg border border-[#22314d] px-3 text-xs text-slate-300">Cancel edit</button>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
            <th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Coins</th><th className="p-3 font-medium">Bonus</th><th className="p-3 font-medium">Price</th><th className="p-3 font-medium">Active</th><th className="p-3 font-medium">Actions</th>
          </tr></thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id} className="border-b border-[#0f1b31]">
                <td className="p-3 font-semibold">{p.name}</td>
                <td className="p-3">{displayCoins(p.coins)}</td>
                <td className="p-3">{displayCoins(p.bonus_coins)}</td>
                <td className="p-3">{formatCoinPrice(p.price_cents)}</td>
                <td className="p-3">{p.is_active ? <span className="text-emerald-300">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                <td className="p-3">
                  <button type="button" onClick={() => beginEdit(p)} className="mr-2 min-h-8 rounded border border-[#22314d] px-2 text-slate-200 hover:border-cyan-400">Edit</button>
                  <button type="button" onClick={() => onAction({ action: 'package', package_id: p.id, is_active: !p.is_active }, `${p.is_active ? 'Deactivate' : 'Activate'} package "${p.name}"?`)}
                    className="rounded border border-[#22314d] px-2 py-1 text-slate-200 hover:border-cyan-400">
                    {p.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {packages.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No packages yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onAction }: { settings: Settings | null; onAction: PostFn }) {
  const [rate, setRate] = useState(String(settings?.centavos_per_coin ?? 100));
  const [highValue, setHighValue] = useState(String(settings?.high_value_adjustment_coins ?? 0));
  const [dailyLimit, setDailyLimit] = useState(String(settings?.max_daily_admin_adjustments ?? 50));

  const save = () => {
    onAction({
      action: 'settings',
      enabled: false,
      topups_enabled: false,
      spending_enabled: false,
      centavos_per_coin: Number(rate),
      high_value_adjustment_coins: Number(highValue || '0'),
      max_daily_admin_adjustments: Number(dailyLimit),
    }, 'Save safe configuration and force all RF Coins feature, funding, and spending switches off?');
  };

  return (
    <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
      <p className="text-sm font-semibold text-slate-100">Wallet settings & release controls</p>
      <p className="mt-1 text-xs leading-5 text-amber-200">Wallet funding is awaiting financial release approval. The database settings are not the release authority and cannot enable payments or coin spending.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-[#1b2a45] p-3 text-xs"><span className="block text-slate-500">Master feature DB switch</span><strong className="mt-1 block text-slate-200">{settings?.enabled ? 'ON (runtime remains gated)' : 'OFF'}</strong></div>
        <div className="rounded-lg border border-[#1b2a45] p-3 text-xs"><span className="block text-slate-500">Funding DB switch</span><strong className="mt-1 block text-rose-200">{settings?.database_topups_enabled ? 'ON · release locked' : 'OFF · release locked'}</strong></div>
        <div className="rounded-lg border border-[#1b2a45] p-3 text-xs"><span className="block text-slate-500">Spending DB switch</span><strong className="mt-1 block text-rose-200">{settings?.database_spending_enabled ? 'ON · release locked' : 'OFF · release locked'}</strong></div>
        <label className="text-xs text-slate-400">Valuation/configuration rate (centavos per RF Coin)<input aria-label="Centavos per RF Coin" className={`${inputCls} mt-1`} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} /><span className="mt-1 block text-[10px]">Current reference: {formatCoinPrice(Number(rate) || 0)} per coin; liability is not cash revenue.</span></label>
        <label className="text-xs text-slate-400">High-value adjustment threshold (RF Coins)<input aria-label="High-value adjustment threshold" className={`${inputCls} mt-1`} inputMode="numeric" value={highValue} onChange={(e) => setHighValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))} /></label>
        <label className="text-xs text-slate-400">Maximum daily admin adjustments<input aria-label="Daily admin adjustment limit" className={`${inputCls} mt-1`} inputMode="numeric" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} /></label>
      </div>
      <button type="button" disabled={!settings} onClick={save} className="mt-4 min-h-10 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40">Save safe settings (all release switches OFF)</button>
    </div>
  );
}

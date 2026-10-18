'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Coins, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import { formatCoins, formatCoinPrice, rfCoinErrorMessage, type RfCoinPackage } from '@/lib/rfCoins';

type Settings = {
  enabled: boolean;
  topups_enabled: boolean;
  spending_enabled: boolean;
  centavos_per_coin: number;
  high_value_adjustment_coins: number;
  max_daily_admin_adjustments: number;
};

type WalletRow = {
  user_id: string;
  balance_coins: number;
  total_purchased_coins: number;
  total_spent_coins: number;
  total_manual_credited_coins: number;
  total_manual_debited_coins: number;
  total_reversed_coins: number;
  updated_at: string;
};

type TopupRow = {
  id: string;
  user_id: string;
  coins: number;
  bonus_coins: number;
  price_cents: number;
  status: string;
  provider_reference: string | null;
  credited_at: string | null;
  created_at: string;
};

type RequestRow = {
  id: string;
  target_user_id: string;
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
  direction: string;
  amount_coins: number;
  kind: string;
  balance_after: number;
  reason: string | null;
  created_at: string;
};

type ApiData = {
  settings: Settings | null;
  wallets: WalletRow[];
  topups: TopupRow[];
  packages: RfCoinPackage[];
  adjustmentRequests: RequestRow[];
  audit: AuditRow[];
  ledger: LedgerRow[];
  metrics: {
    outstanding: number; purchased: number; spent: number; manualCredited: number;
    manualDebited: number; reversed: number; pendingTopups: number;
  };
};

const TABS = ['Overview', 'Customer Wallets', 'Coin Top-Ups', 'Wallet Transactions', 'Manual Adjustments', 'Coin Packages', 'Wallet Settings', 'Audit Logs'] as const;
type Tab = (typeof TABS)[number];

export default function RfCoinsClient() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/rf-coins', { cache: 'no-store' });
      const json = await res.json().catch(() => null) as ApiData & { error?: string } | null;
      if (!res.ok || !json) {
        setError(json?.error || 'Could not load RF Coins data.');
        return;
      }
      setData(json);
      setError('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
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
      <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-6 text-sm text-amber-300">
        <AlertTriangle size={16} className="mr-2 inline" />
        {error || 'No data.'} RF Coins is disabled by default until the schema migration is applied and activated.
      </div>
    );
  }

  const s = data.settings;
  const fmtDate = (v: string) => new Date(v).toLocaleString('en-PH');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${tab === t ? 'bg-gradient-to-r from-blue-500 to-violet-600 text-white' : 'border border-[#22314d] text-slate-300 hover:border-cyan-400'}`}>
            {t}
          </button>
        ))}
      </div>

      {actionMsg && <p className="rounded-lg border border-[#1b2a45] bg-[#0b1225] p-3 text-xs text-slate-200">{actionMsg}</p>}

      {tab === 'Overview' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-xs">
            <span className={s?.enabled ? 'text-emerald-300' : 'text-rose-300'}>Feature: {s?.enabled ? 'ACTIVE' : 'DISABLED'}</span>
            <span className={s?.topups_enabled ? 'text-emerald-300' : 'text-slate-500'}>Top-ups: {s?.topups_enabled ? 'on' : 'off'}</span>
            <span className={s?.spending_enabled ? 'text-emerald-300' : 'text-slate-500'}>Spending: {s?.spending_enabled ? 'on' : 'off'}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Outstanding coins', data.metrics.outstanding],
              ['Coins purchased', data.metrics.purchased],
              ['Coins spent', data.metrics.spent],
              ['Manually issued', data.metrics.manualCredited],
              ['Manually debited', data.metrics.manualDebited],
              ['Refunds/reversals', data.metrics.reversed],
              ['Pending top-ups', data.metrics.pendingTopups],
              ['Pending adjustments', data.adjustmentRequests.filter((r) => r.status === 'PENDING').length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="font-display mt-1 text-lg font-bold text-cyan-300">{formatCoins(Number(value))}</p>
              </div>
            ))}
          </div>
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
              <th className="p-3 font-medium">Customer UUID</th><th className="p-3 font-medium">Balance</th><th className="p-3 font-medium">Purchased</th><th className="p-3 font-medium">Spent</th><th className="p-3 font-medium">Manual +</th><th className="p-3 font-medium">Manual −</th><th className="p-3 font-medium">Reversed</th>
            </tr></thead>
            <tbody>
              {data.wallets.map((w) => (
                <tr key={w.user_id} className="border-b border-[#0f1b31]">
                  <td className="p-3 font-mono text-[10px] text-cyan-300">{w.user_id}</td>
                  <td className="p-3 font-bold">{formatCoins(w.balance_coins)}</td>
                  <td className="p-3">{formatCoins(w.total_purchased_coins)}</td>
                  <td className="p-3">{formatCoins(w.total_spent_coins)}</td>
                  <td className="p-3">{formatCoins(w.total_manual_credited_coins)}</td>
                  <td className="p-3">{formatCoins(w.total_manual_debited_coins)}</td>
                  <td className="p-3">{formatCoins(w.total_reversed_coins)}</td>
                </tr>
              ))}
              {data.wallets.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={7}>No wallets yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Coin Top-Ups' && (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Created</th><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Coins</th><th className="p-3 font-medium">Bonus</th><th className="p-3 font-medium">Price</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Credited</th>
            </tr></thead>
            <tbody>
              {data.topups.map((t) => (
                <tr key={t.id} className="border-b border-[#0f1b31]">
                  <td className="p-3">{fmtDate(t.created_at)}</td>
                  <td className="p-3 font-mono text-[10px] text-cyan-300">{t.user_id}</td>
                  <td className="p-3 font-bold">{formatCoins(t.coins)}</td>
                  <td className="p-3">{formatCoins(t.bonus_coins)}</td>
                  <td className="p-3">{formatCoinPrice(t.price_cents)}</td>
                  <td className="p-3">{t.status}</td>
                  <td className="p-3">{t.credited_at ? fmtDate(t.credited_at) : '—'}</td>
                </tr>
              ))}
              {data.topups.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={7}>No top-ups yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Wallet Transactions' && (
        <div className="overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-[#1b2a45]">
              <th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Direction</th><th className="p-3 font-medium">Coins</th><th className="p-3 font-medium">Kind</th><th className="p-3 font-medium">Balance after</th><th className="p-3 font-medium">Reason</th><th className="p-3 font-medium">Date</th>
            </tr></thead>
            <tbody>
              {data.ledger.map((l) => (
                <tr key={l.id} className="border-b border-[#0f1b31]">
                  <td className="p-3 font-mono text-[10px] text-cyan-300">{l.wallet_user_id}</td>
                  <td className={`p-3 font-bold ${l.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {l.direction === 'credit' ? '+' : '−'}{formatCoins(l.amount_coins)}
                  </td>
                  <td className="p-3">{l.kind}</td>
                  <td className="p-3">{formatCoins(l.balance_after)}</td>
                  <td className="p-3 max-w-[200px] truncate">{l.reason || '—'}</td>
                  <td className="p-3">{fmtDate(l.created_at)}</td>
                </tr>
              ))}
              {data.ledger.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={6}>No wallet transactions yet.</td></tr>}
            </tbody>
          </table>
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
  const [category, setCategory] = useState('support');

  const submit = () => {
    if (!userId || !amount || !reason) return;
    onAction({
      action: 'adjustment',
      target_user_id: userId,
      direction,
      amount_coins: Number(amount),
      reason,
      category,
      idempotency_key: `adj-${userId}-${Date.now()}`,
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
          <input className={inputCls} placeholder="Customer Auth UUID" value={userId} onChange={(e) => setUserId(e.target.value)} />
          <select className={inputCls} value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="credit">Credit (add coins)</option>
            <option value="debit">Debit (remove coins)</option>
          </select>
          <input className={inputCls} placeholder="Amount in RF Coins" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} />
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="support">Support</option>
            <option value="compensation">Compensation</option>
            <option value="correction">Correction</option>
            <option value="promotion">Promotion</option>
            <option value="chargeback">Chargeback</option>
          </select>
          <input className={`${inputCls} sm:col-span-2`} placeholder="Reason (shown in the ledger and audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button type="button" onClick={submit} disabled={!userId || !amount || !reason}
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
                <td className="p-3 font-mono text-[10px] text-cyan-300">{r.target_user_id}</td>
                <td className={`p-3 font-bold ${r.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {r.direction === 'credit' ? '+' : '−'}{formatCoins(r.amount_coins)}
                </td>
                <td className="p-3 max-w-[220px] truncate">{r.reason}</td>
                <td className="p-3">
                  {r.status}
                  {r.is_high_value && <span className="ml-1 text-amber-300">(high value)</span>}
                </td>
                <td className="p-3">
                  {r.status === 'PENDING' && (
                    <span className="flex gap-2">
                      <button type="button" onClick={() => onAction({ action: 'decide', request_id: r.id, approve: true }, `Approve ${r.direction} of ${formatCoins(r.amount_coins)} for customer ${r.target_user_id}?`)}
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
  const [name, setName] = useState('');
  const [coins, setCoins] = useState('');
  const [bonus, setBonus] = useState('');
  const [price, setPrice] = useState('');

  const submit = () => {
    if (!name || !coins || !price) return;
    onAction({
      action: 'package',
      name,
      coins: Number(coins),
      bonus_coins: Number(bonus || '0'),
      price_cents: Math.round(Number(price) * 100),
      is_active: true,
      sort_order: packages.length + 1,
    }, `Create coin package "${name}" (${coins} coins at PHP ${price})? It becomes purchasable once top-ups are enabled.`);
    setName(''); setCoins(''); setBonus(''); setPrice('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
        <p className="text-xs font-semibold text-slate-200">Add coin package</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <input className={inputCls} placeholder="Package name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputCls} placeholder="Coins" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^0-9]/g, ''))} />
          <input className={inputCls} placeholder="Bonus coins" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value.replace(/[^0-9]/g, ''))} />
          <input className={inputCls} placeholder="Price in PHP" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <button type="button" onClick={submit} disabled={!name || !coins || !price}
          className="mt-3 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Create package
        </button>
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
                <td className="p-3">{formatCoins(p.coins)}</td>
                <td className="p-3">{formatCoins(p.bonus_coins)}</td>
                <td className="p-3">{formatCoinPrice(p.price_cents)}</td>
                <td className="p-3">{p.is_active ? <span className="text-emerald-300">Active</span> : <span className="text-slate-500">Inactive</span>}</td>
                <td className="p-3">
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
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [topups, setTopups] = useState(settings?.topups_enabled ?? false);
  const [spending, setSpending] = useState(settings?.spending_enabled ?? false);
  const [rate, setRate] = useState(String((settings?.centavos_per_coin ?? 100) / 100));
  const [highValue, setHighValue] = useState(String(settings?.high_value_adjustment_coins ?? 0));

  const save = () => {
    const wasEnabled = settings?.enabled ?? false;
    onAction({
      action: 'settings',
      enabled,
      topups_enabled: topups,
      spending_enabled: spending,
      centavos_per_coin: Math.round(Number(rate) * 100),
      high_value_adjustment_coins: Number(highValue || '0'),
    }, enabled && !wasEnabled
      ? 'Activate RF Coins for the whole site? Customers will immediately see wallets and coin payment where enabled.'
      : 'Save RF Coins settings?');
  };

  return (
    <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4">
      <p className="text-xs font-semibold text-slate-200">Wallet settings</p>
      <div className="mt-3 space-y-3 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Feature enabled (master switch)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={topups} onChange={(e) => setTopups(e.target.checked)} /> Allow customers to buy coin packages</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={spending} onChange={(e) => setSpending(e.target.checked)} /> Allow paying for orders with RF Coins</label>
        <div className="flex items-center gap-2">1 RF Coin = PHP <input className={`${inputCls} w-24`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
        <div className="flex items-center gap-2">High-value adjustment threshold (coins): <input className={`${inputCls} w-32`} inputMode="numeric" value={highValue} onChange={(e) => setHighValue(e.target.value.replace(/[^0-9]/g, ''))} /></div>
      </div>
      <button type="button" onClick={save} className="mt-3 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2 text-xs font-semibold text-white">Save settings</button>
    </div>
  );
}

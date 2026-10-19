'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coins, Loader2, RefreshCw, X, QrCode } from 'lucide-react';
import { formatCoins, formatCoinPrice, type RfCoinPackage, type RfCoinLedgerEntry, type RfCoinWallet } from '@/lib/rfCoins';

type WalletResponse = {
  wallet: RfCoinWallet | null;
  packages: RfCoinPackage[];
  spendingEnabled?: boolean;
  topupsEnabled?: boolean;
  centavosPerCoin?: number;
};

type LedgerResponse = { entries?: RfCoinLedgerEntry[] };

const KIND_LABELS: Record<string, { label: string; tone: string }> = {
  topup_purchase: { label: 'Purchased', tone: 'text-emerald-300' },
  order_payment: { label: 'Spent on order', tone: 'text-violet-300' },
  order_reversal: { label: 'Order refunded', tone: 'text-amber-300' },
  manual_credit: { label: 'Manual credit', tone: 'text-cyan-300' },
  manual_debit: { label: 'Manual debit', tone: 'text-rose-300' },
  rounding_refund: { label: 'Adjustment', tone: 'text-amber-300' },
  chargeback_reversal: { label: 'Purchase refunded', tone: 'text-amber-300' },
};

export default function WalletClient() {
  const [wallet, setWallet] = useState<RfCoinWallet | null>(null);
  const [packages, setPackages] = useState<RfCoinPackage[]>([]);
  const [ledger, setLedger] = useState<RfCoinLedgerEntry[]>([]);
  const [settings, setSettings] = useState({ spendingEnabled: false, topupsEnabled: false, centavosPerCoin: 100 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<RfCoinPackage | null>(null);
  const [qr, setQr] = useState<{ topupId: string; qrImageUrl: string; amountCents: number; expiresAt: string } | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState('');
  const [ledgerError, setLedgerError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/account/wallet', { cache: 'no-store' });
      const data = await res.json().catch(() => null) as WalletResponse | null;
      if (!res.ok || !data) {
        setError('Could not load your wallet.');
        return;
      }
      setWallet(data.wallet);
      setPackages(data.packages || []);
      setSettings({
        spendingEnabled: Boolean(data.spendingEnabled),
        topupsEnabled: Boolean(data.topupsEnabled),
        centavosPerCoin: Number(data.centavosPerCoin || 100),
      });
      const ledgerRes = await fetch('/api/account/wallet/ledger', { cache: 'no-store' });
      if (ledgerRes.ok) {
        const ledgerData = await ledgerRes.json().catch(() => null) as LedgerResponse | null;
        setLedger(ledgerData?.entries || []);
        setLedgerError('');
      } else {
        setLedgerError('Could not load your transaction history.');
      }
      setError('');
    } catch {
      setError('Could not load your wallet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const buy = async (pkg: RfCoinPackage) => {
    setSelectedPackage(pkg);
    setBuying(true);
    setBuyError('');
    try {
      const res = await fetch('/api/account/wallet/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json().catch(() => null) as { success?: boolean; qrImageUrl?: string; topupId?: string; amountCents?: number; expiresAt?: string; error?: string } | null;
      if (!res.ok || !data?.success || !data.qrImageUrl) {
        setBuyError(data?.error || 'Could not start your coin purchase.');
        return;
      }
      setQr({ topupId: data.topupId!, qrImageUrl: data.qrImageUrl, amountCents: data.amountCents!, expiresAt: data.expiresAt! });
    } catch {
      setBuyError('Could not reach the server. Please try again.');
    } finally {
      setBuying(false);
    }
  };

  const closeQr = () => {
    setQr(null);
    setSelectedPackage(null);
    void load();
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-cyan-300" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-400/25 bg-rose-400/5 p-6 text-sm text-rose-300">{error}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#1b2a45] bg-gradient-to-br from-[#0b1225] to-[#0a1830] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-500">RF Coins Balance</p>
            <p className="font-display mt-1 flex items-center gap-2 text-4xl font-bold text-cyan-300">
              <Coins size={30} className="text-amber-300" />
              {formatCoins(wallet?.balance_coins ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {settings.centavosPerCoin === 100 ? '1 RF Coin = ₱1.00' : `1 RF Coin = ₱${(settings.centavosPerCoin / 100).toFixed(2)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-2 rounded-lg border border-[#22314d] px-3 py-2 text-xs text-slate-300 hover:border-cyan-400"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">Coins Purchased</p>
          <p className="font-display mt-2 text-xl font-bold text-emerald-300">{formatCoins(wallet?.total_purchased_coins ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">Coins Spent</p>
          <p className="font-display mt-2 text-xl font-bold text-violet-300">{formatCoins(wallet?.total_spent_coins ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">Coins Reversed</p>
          <p className="font-display mt-2 text-xl font-bold text-amber-300">{formatCoins(wallet?.total_reversed_coins ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
          <p className="text-xs text-slate-400">Manual Credits / Debits</p>
          <p className="font-display mt-2 text-xl font-bold text-cyan-300">+{formatCoins(wallet?.total_manual_credited_coins ?? 0)} / −{formatCoins(wallet?.total_manual_debited_coins ?? 0)}</p>
        </div>
      </div>

      {settings.topupsEnabled && packages.length > 0 && (
        <div>
          <h2 className="font-display mb-3 text-lg font-bold">Buy RF Coins</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {packages.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => void buy(pkg)}
                disabled={buying}
                className="rounded-xl border border-[#20304b] bg-[#0a1225] p-4 text-left transition hover:border-cyan-400 disabled:opacity-50"
              >
                <p className="font-display text-2xl font-bold text-amber-300">{formatCoins(pkg.coins + pkg.bonus_coins)} RF</p>
                {pkg.bonus_coins > 0 && <p className="mt-0.5 text-xs text-emerald-300">{formatCoins(pkg.coins)} + {formatCoins(pkg.bonus_coins)} bonus</p>}
                <p className="mt-2 text-sm text-slate-300">{formatCoinPrice(pkg.price_cents)}</p>
                <p className="mt-1 text-xs text-slate-500">{buying && selectedPackage?.id === pkg.id ? 'Starting...' : 'Buy via QR Ph'}</p>
              </button>
            ))}
          </div>
          {buyError && <p className="mt-3 text-sm text-rose-400">{buyError}</p>}
          {!settings.topupsEnabled && <p className="mt-3 text-xs text-slate-500">Buying RF Coins is currently disabled.</p>}
        </div>
      )}

      {qr && (
        <div className="rounded-2xl border border-cyan-400/30 bg-[#0a1225] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display flex items-center gap-2 text-sm font-semibold text-cyan-300"><QrCode size={16} /> Scan to Pay</h3>
              <p className="mt-1 text-xs text-slate-400">
                Scan with your banking or e-wallet app to pay {formatCoinPrice(qr.amountCents)}.
                Coins are added automatically after payment is confirmed.
              </p>
            </div>
            <button type="button" onClick={closeQr} className="text-slate-500 hover:text-slate-300" aria-label="Close QR code">
              <X size={18} />
            </button>
          </div>
          <div className="mt-4 flex justify-center">
                        <img src={qr.qrImageUrl} alt="RF Coins payment QR code" className="h-64 w-64 rounded-lg bg-white p-2" />
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">Expires {new Date(qr.expiresAt).toLocaleTimeString('en-PH')}</p>
        </div>
      )}

      <div>
        <h2 className="font-display mb-3 text-lg font-bold">Transaction History</h2>
        {ledgerError && <p className="text-sm text-rose-400">{ledgerError}</p>}
        <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225]">
          {ledger.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-[#0f1b31]">
              {ledger.map((entry) => {
                const meta = KIND_LABELS[entry.kind] || { label: entry.kind, tone: 'text-slate-300' };
                return (
                  <div key={entry.id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className={`text-sm font-medium ${meta.tone}`}>{meta.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{entry.reason || '—'} · {new Date(entry.created_at).toLocaleString('en-PH')}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-display text-sm font-bold ${entry.direction === 'credit' ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {entry.direction === 'credit' ? '+' : '−'}{formatCoins(entry.amount_coins)}
                      </p>
                      <p className="text-xs text-slate-500">Balance {formatCoins(entry.balance_after)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethodKey } from '@/lib/paymentMethods';
import { formatCoins } from '@/lib/rfCoins';
import { ArrowLeft, BadgeCheck, ChevronDown, CircleHelp, CreditCard, Download, Info, Loader2, LockKeyhole, Mail, ShieldCheck, Sparkles, Tag, Ticket, Upload, UserRound, WalletCards, X, Zap } from 'lucide-react';

import { createPortal } from 'react-dom';
import SiteFooter from '@/components/SiteFooter';

type Game = { id: string; slug: string; name: string; description: string; region: string; currency: string; banner_url?: string | null; logo_url?: string | null };
type Field = { id: string; label: string; field_key: string; placeholder: string; help_text: string; is_required: boolean };
type Package = { id: string; name: string; amount: string; price_cents: number; original_price_cents: number | null; bonus: string | null; sort_order?: number; badge?: string | null; image_url?: string | null };
type DbPaymentMethod = { method_key: string; display_name: string; is_enabled: boolean; logo_url: string | null };

const METHOD_STYLES: Record<string, { detail: string; className: string }> = {
  gcash: { detail: 'Pay with GCash', className: 'from-[#1262c5] to-[#0d3e91]' },
  maya: { detail: 'Pay with Maya', className: 'from-[#0b8f68] to-[#056245]' },
  coinsph: { detail: 'Pay with Coins.ph', className: 'from-[#ea9f2d] to-[#b85b13]' },
  bank_transfer: { detail: 'Bank Transfer', className: 'from-[#334155] to-[#1e293b]' },
  paymongo_qrph: { detail: 'Scan & pay with QR Ph', className: 'from-[#0d7a5f] to-[#075c47]' },
};
const DEFAULT_STYLE = { detail: 'Manual Payment', className: 'from-[#475569] to-[#334155]' };

const ORDER_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'text-slate-300 border-slate-500/40 bg-slate-500/10' },
  WAITING_PAYMENT: { label: 'Waiting Payment', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  PAYMENT_VERIFIED: { label: 'Payment Verified', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  PAID: { label: 'Paid', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  PROCESSING: { label: 'Processing', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10' },
  COMPLETED: { label: 'Completed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  FULFILLMENT_FAILED: { label: 'Fulfillment Failed', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10' },
  FAILED: { label: 'Failed', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10' },
  EXPIRED: { label: 'Expired', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10' },
  CANCELLED: { label: 'Cancelled', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10' },
  REFUND_PENDING: { label: 'Refund Pending', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  REFUNDED: { label: 'Refunded', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10' },
};

function formatPrice(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function discountPercent(pkg: Package): number {
  if (!pkg.original_price_cents || pkg.original_price_cents <= pkg.price_cents) return 0;
  return Math.round((1 - pkg.price_cents / pkg.original_price_cents) * 100);
}

function gameBadge(name: string): string {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 4).toUpperCase();
  return initials.length >= 2 ? initials : name.slice(0, 4).toUpperCase();
}

export default function GameTopUp({ game, fields, packages, dbPaymentMethods = [], bannerUrl = null, coinPaymentEnabled = false }: { game: Game; fields: Field[]; packages: Package[]; dbPaymentMethods?: DbPaymentMethod[]; bannerUrl?: string | null; coinPaymentEnabled?: boolean }) {
  const [coinWallet, setCoinWallet] = useState<{ balance: number } | null>(null);

  useEffect(() => {
    if (!coinPaymentEnabled) return;
    // Load the wallet balance only when the server has enabled coin payment.
    void (async () => {
      try {
        const res = await fetch('/api/account/wallet', { cache: 'no-store' });
        const data = await res.json().catch(() => null) as { wallet?: { balance_coins?: number } | null } | null;
        if (res.ok && data?.wallet) setCoinWallet({ balance: Number(data.wallet.balance_coins || 0) });
      } catch {
        setCoinWallet(null);
      }
    })();
  }, [coinPaymentEnabled]);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(packages[0] || null);
  const [playerInputs, setPlayerInputs] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [verified, setVerified] = useState(false);
  const [verifiedName, setVerifiedName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [voucher, setVoucher] = useState<{ code: string; discount: number; total: number } | null>(null);
  const [voucherError, setVoucherError] = useState('');
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [qrModal, setQrModal] = useState<{ reference: string; totalCents: number; qrData: string | null; displayName: string } | null>(null);
  const [proofFile, setProofFile] = useState<string | null>(null);
  const [txnId, setTxnId] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofError, setProofError] = useState('');
  const [proofSuccess, setProofSuccess] = useState(false);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [bannerAspect, setBannerAspect] = useState<number | null>(null);

  useEffect(() => {
    if (!bannerUrl) return;
    const probe = new window.Image();
    probe.onload = () => { if (probe.naturalWidth > 0 && probe.naturalHeight > 0) setBannerAspect(probe.naturalWidth / probe.naturalHeight); };
    probe.src = bannerUrl;
  }, [bannerUrl]);

  useEffect(() => {
    if (!qrModal || !proofSuccess) {
      setOrderStatus(null);
      setStatusUpdatedAt(null);
      setStatusUpdating(false);
      setStatusError('');
      return;
    }

    let cancelled = false;
    const pollStatus = async () => {
      setStatusUpdating(true);
      try {
        const lookupResponse = await fetch('/api/orders/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: qrModal.reference, email: email.trim() }),
          cache: 'no-store',
        });
        const lookupData = await lookupResponse.json().catch(() => null) as { order?: { id?: string; status?: string; updated_at?: string }; error?: string } | null;
        const orderId = lookupData?.order?.id;
        if (!lookupResponse.ok || !orderId) throw new Error(lookupData?.error || 'Could not load order status.');

        const statusResponse = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status-check`, { cache: 'no-store' });
        const statusData = await statusResponse.json().catch(() => null) as { status?: string; updated_at?: string; error?: string } | null;
        if (!statusResponse.ok || !statusData?.status) throw new Error(statusData?.error || 'Could not load order status.');
        if (cancelled) return;
        setOrderStatus(statusData.status);
        setStatusUpdatedAt(statusData.updated_at || lookupData.order?.updated_at || new Date().toISOString());
        setStatusError('');
      } catch (pollError) {
        if (!cancelled) setStatusError(pollError instanceof Error ? pollError.message : 'Could not update order status.');
      } finally {
        if (!cancelled) setStatusUpdating(false);
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => { void pollStatus(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [email, proofSuccess, qrModal]);

  const specialPackages = useMemo(() => packages.filter((pkg) => {
    const normalizedName = pkg.name.toLowerCase();
    return normalizedName === 'weekly diamond pass' || normalizedName === 'twilight pass' || normalizedName.includes('first top-up bonus');
  }), [packages]);
  const diamondPackages = useMemo(() => packages.filter((pkg) => {
    const normalizedName = pkg.name.toLowerCase();
    return normalizedName !== 'weekly diamond pass' && normalizedName !== 'twilight pass' && !normalizedName.includes('first top-up bonus');
  }), [packages]);
  const displayFields = fields.length ? fields : [
    { id: 'user-id', label: 'User ID', field_key: 'user_id', placeholder: 'Enter your User ID', help_text: 'Find your User ID on your profile.', is_required: true },
    { id: 'zone-id', label: 'Zone ID', field_key: 'zone_id', placeholder: 'Enter your Zone ID', help_text: 'Find your Zone ID beside your User ID.', is_required: true },
  ];
  const resolvedMethods = useMemo(() => {
    const base = dbPaymentMethods.length > 0
      ? dbPaymentMethods.map((m) => {
          const style = METHOD_STYLES[m.method_key] || DEFAULT_STYLE;
          return { key: m.method_key, name: m.display_name, detail: style.detail, className: style.className, logo_url: m.logo_url || null };
        })
      : PAYMENT_METHODS.map((m) => ({ ...m, logo_url: null as string | null }));
    if (!coinPaymentEnabled) return base;
    const coinsNeeded = selectedPackage ? Math.ceil(selectedPackage.price_cents / 100) : null;
    const coinMethod = {
      key: 'rf_coin_wallet',
      name: 'RF Coins Wallet',
      detail: coinWallet && coinsNeeded
        ? `${formatCoins(coinWallet.balance)} RF verfügbar · Kosten: ${formatCoins(coinsNeeded)} RF · Danach: ${formatCoins(Math.max(0, coinWallet.balance - coinsNeeded))} RF`
        : 'Bezahlen Sie vollständig mit Ihrem RF-Coins-Guthaben',
      className: 'from-[#b45309] to-[#92400e]',
      logo_url: null as string | null,
    };
    const insufficient = Boolean(coinWallet && coinsNeeded && coinWallet.balance < coinsNeeded);
    return [...base, { ...coinMethod, insufficient } as typeof base[number] & { insufficient?: boolean }];
  }, [dbPaymentMethods, coinPaymentEnabled, coinWallet, selectedPackage]);

  const isUidOnly = useMemo(() => displayFields.every((field) => field.field_key === 'uid'), [displayFields]);
  const emailValid = Boolean(email.trim() && email.includes('@'));
  const coinPaymentSelected = paymentMethod === 'rf_coin_wallet';
  const coinBalanceSufficient = !coinPaymentSelected || Boolean(
    coinWallet && selectedPackage && coinWallet.balance >= Math.ceil(selectedPackage.price_cents / 100));
  const isReady = Boolean(verified && selectedPackage && paymentMethod && emailValid && coinBalanceSufficient);

  const subtotalCents = selectedPackage?.price_cents ?? 0;
  const finalCents = voucher ? voucher.total : subtotalCents;

  const applyVoucher = async () => {
    const code = voucherCode.trim().toUpperCase();
    if (!code) { setVoucherError('Enter a voucher code.'); return; }
    if (!selectedPackage) { setVoucherError('Choose a package first.'); return; }
    setVoucherChecking(true);
    setVoucherError('');
    try {
      const res = await fetch('/api/vouchers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, packageId: selectedPackage.id, gameId: game.id, email: email.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setVoucher(null);
        setVoucherError(data?.error || 'This voucher could not be applied.');
        return;
      }
      setVoucher({ code: data.voucher.code, discount: data.discount, total: data.total });
    } catch {
      setVoucherError('Could not check this voucher. Please try again.');
    } finally {
      setVoucherChecking(false);
    }
  };

  const removeVoucher = () => { setVoucher(null); setVoucherCode(''); setVoucherError(''); };

  const openReview = () => {
    if (!isReady) return;
    setError('');
    setShowReview(true);
  };

  const supportsVerification = game.slug === 'mobile-legends' || game.slug === 'mlbb';

  const updateInput = (field: Field, value: string) => {
    setVerified(false);
    setVerifiedName('');
    setPlayerInputs((current) => ({ ...current, [field.field_key]: value }));
  };

  const verifyPlayer = async () => {
    setError('');
    setMessage('');
    setVerifiedName('');
    const missing = displayFields.find((field) => field.is_required && !playerInputs[field.field_key]?.trim());
    if (missing) {
      setError(`Enter your ${missing.label} first.`);
      return;
    }
    if (isUidOnly || !supportsVerification) {
      setVerified(true);
      setMessage('Details saved. You can proceed to checkout.');
      return;
    }
    setVerifying(true);
    try {
      const userId = (playerInputs['user_id'] || '').trim();
      const zoneId = (playerInputs['zone_id'] || playerInputs['server_id'] || '').trim();
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl) {
        setError('Verification is temporarily unavailable.');
        return;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      let res: Response;
      try {
        res = await fetch(`${supabaseUrl}/functions/v1/verify-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game_id: game.slug, user_id: userId, zone_id: zoneId }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not verify player. Please double-check your IDs and try again.');
        return;
      }
      setVerified(true);
      setVerifiedName(data.data?.username || '');
      setMessage('');
    } catch {
      setError('Could not reach the verification server. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const submitOrder = async () => {
    if (!isReady || !selectedPackage || !paymentMethod) return;
    setSubmitting(true);
    try {
      const response = await fetch(coinPaymentSelected ? '/api/orders/coin' : '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.id, packageId: selectedPackage.id, email: email.trim(), name: 'RunFazone Customer', playerInputs, paymentMethod: paymentMethod, voucherCode: voucher?.code || '' }),
      });
      const data = await response.json() as { reference?: string; totalCents?: number; coinsCharged?: number; balanceAfter?: number; qrData?: string | null; paymentDisplayName?: string; error?: string };
      if (!response.ok || !data.reference) {
        setError(data.error || 'We could not create your order. Please try again.');
        setShowReview(false);
        return;
      }
      setShowReview(false);
      if (coinPaymentSelected) {
        setQrModal({
          reference: data.reference,
          totalCents: data.totalCents ?? finalCents,
          qrData: null,
          displayName: `RF Coins Wallet · ${formatCoins(data.coinsCharged ?? 0)} RF abgebucht · Restguthaben: ${formatCoins(data.balanceAfter ?? 0)} RF`,
        });
        return;
      }
      // For QR Ph (automated), redirect to checkout page which generates
      // a dynamic QR via PayMongo - no manual proof upload needed.
      if (paymentMethod === 'paymongo_qrph') {
        window.location.assign(`/checkout?ref=${encodeURIComponent(data.reference)}`);
        return;
      }
      setQrModal({
        reference: data.reference,
        totalCents: data.totalCents ?? finalCents,
        qrData: data.qrData ?? null,
        displayName: data.paymentDisplayName || paymentMethodLabel(paymentMethod),
      });
    } catch {
      setError('We could not reach checkout. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const packageCard = (pkg: Package) => {
    const badge = pkg.badge || pkg.bonus;
    const discount = discountPercent(pkg);
    const isSelected = selectedPackage?.id === pkg.id;
    return <button key={pkg.id} type="button" onClick={() => { setSelectedPackage(pkg); setMessage(''); }} className={`relative min-h-[104px] rounded-xl border p-3 text-left transition ${isSelected ? 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_22px_rgba(34,211,238,.14)]' : 'border-[#20304b] bg-[#0a1225] hover:border-[#3d5c80]'}`}>
      {badge && (badge.toLowerCase().includes('popular') || badge.toLowerCase().includes('best')) && <span className="absolute -top-2 right-2 rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2 py-0.5 text-[9px] font-semibold text-white">{badge}</span>}
      {pkg.image_url && pkg.image_url.startsWith('https://') && (
        <div className="mb-2 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pkg.image_url} alt={pkg.name} className="h-14 w-14 object-contain" />
        </div>
      )}
      <span className="block text-xs font-semibold text-slate-100">{pkg.name}</span>
      <span className="mt-3 block font-display text-base font-bold text-cyan-300">{formatPrice(pkg.price_cents)}</span>
      {pkg.original_price_cents && <span className="block text-[10px] text-slate-600 line-through">{formatPrice(pkg.original_price_cents)} {discount > 0 && <span className="ml-1 text-emerald-400 no-underline">-{discount}%</span>}</span>}
      {isSelected && <span className="absolute right-2 bottom-2 grid h-4 w-4 place-items-center rounded-full bg-cyan-300 text-[#061023]"><BadgeCheck size={12} /></span>}
    </button>;
  };

  return <main className="min-h-screen bg-[#030718] text-slate-100">
    <header className="sticky top-0 z-30 border-b border-[#14203a] bg-[#030718]/95 backdrop-blur-xl"><div className="mx-auto flex max-w-[760px] items-center justify-between px-4 py-4"><a href="/" className="inline-flex items-center gap-2 text-xs text-slate-300 transition hover:text-cyan-300"><ArrowLeft size={15} /> Back to games</a><span className="font-display text-sm font-bold">Run<span className="text-cyan-300">Fazone</span></span><a href="/track-order" className="text-xs text-slate-400 hover:text-cyan-300">Track order</a></div></header>

    <div className="mx-auto max-w-[760px] px-4 pb-28 pt-5">
      <section className="relative overflow-hidden rounded-2xl border border-[#1c3855] bg-gradient-to-br from-[#0d3049] via-[#10182e] to-[#230d32] shadow-[inset_0_0_80px_rgba(16,156,214,.12)]" style={bannerAspect ? { aspectRatio: String(bannerAspect) } : { minHeight: '280px' }}>
        {bannerUrl && <img src={bannerUrl} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />}
        {bannerUrl && <div className="absolute inset-0 bg-gradient-to-r from-[#030718]/80 via-[#030718]/40 to-transparent" />}
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" /><div className="absolute -bottom-28 -left-20 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="relative flex h-full flex-col justify-center p-4 sm:p-6 md:p-8"><div className="flex items-start gap-2.5 sm:gap-4">{game.slug === 'mobile-legends' ? <img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1753406334/app_icon_0_sstwtq.png" alt="Mobile Legends" width={200} height={200} className="h-10 w-10 shrink-0 rounded-xl border border-white/15 object-cover shadow-lg sm:h-14 sm:w-14 sm:rounded-2xl" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/10 font-display text-[10px] font-bold text-cyan-200 shadow-lg sm:h-14 sm:w-14 sm:rounded-2xl sm:text-xs">{gameBadge(game.name)}</span>}<div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-cyan-300 sm:text-[10px] sm:tracking-[.22em]">Secure Top-Up</p><h1 className="font-display mt-1 text-lg font-bold leading-tight sm:text-2xl sm:leading-tight md:text-3xl">{game.name}</h1><p className="mt-1.5 text-[11px] leading-snug text-slate-300 sm:mt-2 sm:text-xs sm:leading-5">{game.description || `Fast, safe, and affordable top-ups for your next match.`}</p></div></div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-[9px] text-slate-300 sm:mt-7 sm:gap-2 sm:text-[10px]"><span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 sm:px-3 sm:py-1"><ShieldCheck size={11} className="mr-1 inline text-cyan-300 sm:size-3" />Verified delivery</span><span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 sm:px-3 sm:py-1"><Zap size={11} className="mr-1 inline text-amber-300 sm:size-3" />Instant processing</span></div></div>
      </section>

      <section className="mt-5 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="font-display text-lg font-bold">Player Details</h2><p className="mt-1 text-xs text-slate-500">Enter your {game.name} account information</p></div><UserRound size={19} className="text-cyan-300" /></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{displayFields.slice(0, 2).map((field) => <label key={field.id} className="block"><span className="mb-1.5 block text-xs font-medium text-slate-300">{field.label} <span className="text-cyan-300">*</span></span><input value={playerInputs[field.field_key] || ''} onChange={(event) => updateInput(field, event.target.value)} placeholder={field.placeholder} className="w-full rounded-xl border border-[#233653] bg-[#080f20] px-3.5 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300" /></label>)}</div><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"><button type="button" onClick={verifyPlayer} disabled={verifying} className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition ${verified ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-cyan-400/50 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20'}`}>{verified ? <BadgeCheck size={14} /> : <ShieldCheck size={14} />}{verifying ? 'Verifying...' : verified ? 'Player Verified' : 'Verify Player'}</button>{(error || message) && <div className={`min-w-0 sm:flex-1 rounded-xl border p-3 text-xs ${error ? 'border-rose-400/25 bg-rose-400/5 text-rose-300' : 'border-emerald-400/25 bg-emerald-400/5 text-emerald-300'}`}>{error || message}</div>}{verified && verifiedName && <div className="min-w-0 sm:flex-1 flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3"><BadgeCheck size={15} className="shrink-0 text-emerald-300" /><div><p className="text-xs font-semibold text-emerald-300">In-Game Name</p><p className="text-sm font-bold text-slate-100">{verifiedName}</p></div></div>}</div><div className="mt-4 flex gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3 text-[11px] leading-5 text-slate-400"><CircleHelp size={15} className="mt-0.5 shrink-0 text-cyan-300" /><p>{isUidOnly ? 'You can find your UID by opening your profile in the game. It is the number shown below your avatar.' : 'You can find your User ID and Zone ID by opening your profile in the game. Check the numbers shown below your avatar.'}</p></div></section>

      <section className="mt-5 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6"><div><h2 className="font-display text-lg font-bold">Packages</h2><p className="mt-1 text-xs text-slate-500">Choose your package</p></div>{specialPackages.length > 0 && <div className="mt-5"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-violet-200"><Sparkles size={14} className="text-violet-300" /> Special Item</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{specialPackages.map(packageCard)}</div></div>}<div className="mt-6"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-cyan-200"><Zap size={14} className="text-cyan-300" /> Packages</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{diamondPackages.map(packageCard)}</div>{diamondPackages.length === 0 && <p className="text-xs text-slate-500">No diamond packages are currently available.</p>}</div></section>

      <section className="mt-5 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6"><div><h2 className="font-display text-lg font-bold">Payment Methods</h2><p className="mt-1 text-xs text-slate-500">Choose your preferred payment method</p></div><div className="mt-5 grid gap-2 sm:grid-cols-3">{resolvedMethods.map((method) => <button key={method.key} type="button" onClick={() => setPaymentMethod(method.key)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${paymentMethod === method.key ? 'border-cyan-300 bg-cyan-400/10 shadow-[0_0_18px_rgba(34,211,238,.1)]' : 'border-[#20304b] bg-[#080f20] hover:border-[#3d5c80]'}`}><span className={`grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-gradient-to-br ${method.className} text-[10px] font-bold text-white`}>{method.logo_url ? <img src={method.logo_url} alt={method.name} className="h-full w-full object-contain bg-[#0e1a33]" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : method.key === 'gcash' ? <img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1753698010/gcash1_icon_f4qiy0.png" alt="GCash" className="h-full w-full object-cover bg-[#0e1a33]" /> : method.key === 'maya' ? <img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1753698009/maya1_icon_jlw6zs.png" alt="Maya" className="h-full w-full object-cover bg-[#0e1a33]" /> : method.key === 'coinsph' ? <img src="https://res.cloudinary.com/dex5ykrfs/image/upload/v1760245657/coinsph_icon_znsgeu.png" alt="Coins.ph" className="h-full w-full object-cover bg-[#0e1a33]" /> : method.name[0]}</span><span><span className="block text-xs font-semibold">{method.name}</span><span className="block text-[10px] text-slate-500">{method.detail}</span></span>{paymentMethod === method.key && <BadgeCheck size={15} className="ml-auto text-cyan-300" />}</button>)}</div></section>

      <section className="mt-5 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6"><div><h2 className="font-display text-lg font-bold">Order Tracking</h2><p className="mt-1 text-xs text-slate-500">Enter your email to track order</p></div><label className="mt-5 block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300"><Mail size={13} className="text-cyan-300" /> Email Address</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setMessage(''); }} placeholder="Enter your email address" className="w-full rounded-xl border border-[#233653] bg-[#080f20] px-3.5 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300" /></label><div className="mt-4 flex gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-[11px] leading-5 text-slate-400"><Info size={15} className="mt-0.5 shrink-0 text-emerald-300" /><p>Your order number and payment instructions will be sent to this email address.</p></div></section>

      <section className="mt-5 rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="font-display text-lg font-bold">Voucher</h2><p className="mt-1 text-xs text-slate-500">Have a discount code? Apply it here (optional)</p></div><Ticket size={19} className="text-cyan-300" /></div>{voucher ? (<div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4"><div className="flex items-center gap-3"><BadgeCheck size={18} className="shrink-0 text-emerald-300" /><div><p className="text-xs font-semibold text-emerald-300">{voucher.code} applied</p><p className="mt-0.5 text-[11px] text-slate-400">−{formatPrice(voucher.discount)} off · new total {formatPrice(voucher.total)}</p></div></div><button type="button" onClick={removeVoucher} className="text-xs text-slate-400 underline underline-offset-2 transition hover:text-rose-300">Remove</button></div>) : (<div className="mt-5 flex gap-2"><input value={voucherCode} onChange={(event) => { setVoucherCode(event.target.value.toUpperCase()); setVoucherError(''); }} placeholder="Enter voucher code" maxLength={50} className="min-w-0 flex-1 rounded-xl border border-[#233653] bg-[#080f20] px-3.5 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-300" /><button type="button" onClick={applyVoucher} disabled={voucherChecking || !voucherCode.trim()} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-cyan-400/50 bg-cyan-400/10 px-4 py-3 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40">{voucherChecking ? 'Checking...' : 'Apply'}</button></div>)}{voucherError && !voucher && <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/5 p-3 text-xs text-rose-300">{voucherError}</p>}</section>

      <section className="sticky bottom-3 z-10 mt-5 rounded-2xl border border-cyan-300/25 bg-[#081329]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-5"><div className="flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-slate-500">Selected package</p><p className="mt-1 truncate text-sm font-semibold">{selectedPackage?.name || 'Choose a package'}</p>{selectedPackage && <p className="text-[11px] text-slate-500">{formatPrice(subtotalCents)}{voucher ? ` → ${formatPrice(finalCents)}` : ''} · {paymentMethod ? paymentMethodLabel(paymentMethod) : 'Choose payment'}</p>}</div><button type="button" onClick={openReview} disabled={!isReady} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3 text-xs font-bold shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><LockKeyhole size={14} />Review Order</button></div></section>

      {qrModal && createPortal(
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-[#253451] bg-[#0b1225] p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div><h2 className="font-display text-base font-bold">Payment QR</h2><p className="mt-0.5 text-[11px] text-slate-500">Scan and pay to complete your order</p></div>
              <button type="button" onClick={() => setQrModal(null)} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-lg border border-[#253451] text-slate-400 transition hover:border-rose-400 hover:text-rose-300"><X size={14} /></button>
            </div>
            <div className="mt-2 flex flex-col items-center">
              {qrModal.qrData ? (
                <div className="rounded-lg border border-[#253451] bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrModal.qrData} alt={`${qrModal.displayName} QR code`} className="h-44 w-44 object-contain" />
                </div>
              ) : (
                <div className="flex h-44 w-44 flex-col items-center justify-center rounded-lg border border-[#253451] bg-[#080f20] text-center text-xs text-slate-500">
                  <CreditCard size={24} className="mb-1 text-slate-600" />
                  No QR image configured for this payment method.
                </div>
              )}
              <p className="mt-1.5 text-xs text-slate-400">{qrModal.displayName}</p>
              <p className="mt-0.5 font-display text-lg font-bold text-cyan-300">Send exactly {formatPrice(qrModal.totalCents)}</p>
              <p className="mt-1 text-center text-xs text-slate-500">Scan the QR and send the exact amount.</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Order #: <span className="font-mono text-cyan-300">{qrModal.reference}</span></p>
            </div>

            {/* Payment proof submission */}
            {proofSuccess ? (
              <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3 text-center">
                <ShieldCheck size={18} className="mx-auto text-emerald-300" />
                <p className="mt-1 text-sm font-semibold text-emerald-300">Payment proof submitted</p>
                <p className="mt-0.5 text-xs text-slate-400">Waiting for admin verification. You can track your order status anytime.</p>
                <div className="mt-3 rounded-lg border border-[#253451] bg-[#080f20] p-3 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                    {statusUpdating && <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300"><Loader2 size={10} className="animate-spin" /> Updating...</span>}
                  </div>
                  {orderStatus ? (() => {
                    const statusInfo = ORDER_STATUS_LABELS[orderStatus] || { label: 'Processing', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10' };
                    return <p className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusInfo.tone}`}>{statusInfo.label}</p>;
                  })() : <p className="mt-1 text-xs text-slate-500">Loading status...</p>}
                  {statusUpdatedAt && <p className="mt-2 text-[10px] text-slate-500">Last updated {new Date(statusUpdatedAt).toLocaleTimeString()}</p>}
                  {statusError && <p className="mt-2 text-[10px] text-rose-300">{statusError}</p>}
                </div>
              </div>
            ) : (
              <div className="mt-3 border-t border-[#1b2a45] pt-2.5">
                <h3 className="font-display text-sm font-semibold text-slate-200">Submit Payment Proof</h3>
                <p className="mt-0.5 text-xs text-slate-500">Upload your payment screenshot and enter the transaction ID.</p>
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-slate-400">Upload Payment Proof (screenshot/image)</span>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 cursor-pointer rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-xs text-slate-400 transition hover:border-cyan-400">
                        <span className="inline-flex items-center gap-2"><Upload size={12} /> {proofFile ? 'Change image' : 'Choose image'}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setProofError('');
                          const img = new Image();
                          const url = URL.createObjectURL(file);
                          img.onload = () => {
                            URL.revokeObjectURL(url);
                            const maxDim = 1280;
                            let { width, height } = img;
                            if (width > maxDim || height > maxDim) {
                              const scale = maxDim / Math.max(width, height);
                              width = Math.round(width * scale);
                              height = Math.round(height * scale);
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) { setProofError('Could not process image. Please try another.'); return; }
                            ctx.drawImage(img, 0, 0, width, height);
                            let quality = 0.8;
                            let dataUrl = canvas.toDataURL('image/jpeg', quality);
                            while (dataUrl.length > 500_000 && quality > 0.3) {
                              quality -= 0.1;
                              dataUrl = canvas.toDataURL('image/jpeg', quality);
                            }
                            setProofFile(dataUrl);
                          };
                          img.onerror = () => { URL.revokeObjectURL(url); setProofError('Could not load image. Please try another.'); };
                          img.src = url;
                        }} />
                      </label>
                      {proofFile && (
                        <span className="text-[10px] text-emerald-300">Selected</span>
                      )}
                    </div>
                    {proofFile && (
                      <div className="mt-1.5 rounded-lg border border-[#253451] bg-white p-1.5 inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proofFile} alt="Payment proof preview" className="h-16 w-16 object-cover" />
                      </div>
                    )}
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-slate-400">Transaction ID / Reference Number</span>
                    <input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="e.g. TXN123456789" className="h-9 w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 text-sm outline-none focus:border-cyan-400" />
                  </label>
                  {proofError && <p className="text-xs text-rose-400">{proofError}</p>}
                  <button type="button" onClick={async () => {
                    if (!proofFile && !txnId.trim()) { setProofError('Upload a screenshot or enter a transaction ID.'); return; }
                    setProofSubmitting(true);
                    setProofError('');
                    try {
                      const res = await fetch('/api/orders/submit-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          orderReference: qrModal.reference,
                          email: email.trim(),
                          paymentMethod: paymentMethod,
                          referenceNumber: txnId.trim(),
                          proofUrl: proofFile,
                        }),
                      });
                      let data: { error?: string; success?: boolean } | null = null;
                      try { data = await res.json(); } catch {
                        setProofError(res.status === 413 || res.status === 502 ? 'Payment proof is too large. Please choose another image.' : 'Could not reach the server. Please try again.');
                        return;
                      }
                      if (!res.ok || !data?.success) { setProofError(data?.error || 'Could not submit payment proof.'); return; }
                      setProofSuccess(true);
                    } catch {
                      setProofError('Could not reach the server. Please try again.');
                    } finally {
                      setProofSubmitting(false);
                    }
                  }} disabled={proofSubmitting} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 text-sm font-semibold disabled:opacity-40">
                    {proofSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={13} />}
                    {proofSubmitting ? 'Submitting...' : 'Submit Payment'}
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {qrModal.qrData && (
                <a href={qrModal.qrData} download={`qr-${qrModal.reference}.png`} className="flex-1 rounded-lg border border-[#253451] px-3 py-2 text-center text-xs font-semibold text-slate-200 transition hover:border-cyan-400">
                  <span className="inline-flex items-center gap-1.5"><Download size={13} /> Download QR</span>
                </a>
              )}
              <button type="button" onClick={() => window.location.assign(`/checkout?ref=${encodeURIComponent(qrModal.reference)}`)} className="flex-1 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-3 py-2 text-xs font-bold shadow-lg shadow-blue-900/30 transition hover:brightness-110">
                Go to Checkout
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showReview && selectedPackage && paymentMethod && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#253451] bg-[#0b1225] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div><h2 className="font-display text-lg font-bold">Order Summary</h2><p className="mt-0.5 text-xs text-slate-500">Please review before confirming</p></div>
              <button type="button" onClick={() => setShowReview(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-[#253451] text-slate-400 transition hover:border-rose-400 hover:text-rose-300"><X size={15} /></button>
            </div>
            <div className="mt-5 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4"><span className="text-slate-500">Game</span><span className="text-right font-medium">{game.name}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Package</span><span className="text-right font-medium">{selectedPackage.name}</span></div>
              {verifiedName && <div className="flex justify-between gap-4"><span className="text-slate-500">Player</span><span className="text-right font-semibold text-emerald-300">{verifiedName}</span></div>}
              {displayFields.slice(0, 2).map((field) => <div key={field.id} className="flex justify-between gap-4"><span className="text-slate-500">{field.label}</span><span className="text-right font-mono text-[13px]">{playerInputs[field.field_key] || '—'}</span></div>)}
              <div className="flex justify-between gap-4"><span className="text-slate-500">Payment Method</span><span className="text-right font-medium">{paymentMethodLabel(paymentMethod)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-slate-500">Email</span><span className="text-right break-all font-medium">{email.trim()}</span></div>
              <div className="mt-4 border-t border-[#1b2a45] pt-3">
                <div className="flex justify-between gap-4 text-sm"><span className="text-slate-500">Original Price</span><span className="text-right font-medium">{formatPrice(subtotalCents)}</span></div>
                {voucher && <div className="mt-2 flex justify-between gap-4 text-sm"><span className="text-slate-500">Voucher ({voucher.code})</span><span className="text-right font-medium text-emerald-300">−{formatPrice(voucher.discount)}</span></div>}
                <div className="mt-3 flex items-center justify-between gap-4"><span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total</span><span className="font-display text-2xl font-bold text-cyan-300">{formatPrice(finalCents)}</span></div>
              </div>
            </div>
            {error && <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/5 p-3 text-xs text-rose-300">{error}</p>}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => setShowReview(false)} className="flex-1 rounded-xl border border-[#253451] px-4 py-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500">Go Back</button>
              <button type="button" onClick={submitOrder} disabled={submitting} className="flex-[2] rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3 text-xs font-bold shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? 'Creating Order...' : 'Confirm & Create Order'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <section className="mt-10 border-t border-[#14203a] pt-8"><h2 className="font-display text-xl font-bold">Safe and Cheapest {game.name} Top-Ups in the Philippines</h2><p className="mt-3 text-xs leading-6 text-slate-400">Top up your {game.name} account with confidence. RunFazone offers fast delivery, competitive prices, and a secure checkout experience for every player.</p><div className="mt-5 grid gap-3 sm:grid-cols-3">{[['Fast Delivery', Zap, 'Get your recharge almost instantly.'], ['Best Prices', WalletCards, 'Affordable bundles for every budget.'], ['Secure & Safe', ShieldCheck, 'Your account information stays protected.']].map(([title, Icon, body]) => <div key={title as string} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4"><Icon size={17} className="text-cyan-300" /><h3 className="mt-3 text-xs font-semibold">{title as string}</h3><p className="mt-1 text-[11px] leading-5 text-slate-500">{body as string}</p></div>)}</div></section>

      <section className="mt-10"><h2 className="font-display text-xl font-bold">How to Recharge - Step by Step</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{['Enter Your Details', 'Select Your Package', 'Choose Payment Method', 'Proceed to Checkout', 'Payment Confirmed', 'Credits Instantly Received'].map((step, index) => <div key={step} className="flex items-center gap-3 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-cyan-400/10 font-display text-sm font-bold text-cyan-300">{index + 1}</span><span className="text-xs font-medium">{step}</span></div>)}</div></section>
  
      <SiteFooter />
    </div>
  </main>;
}

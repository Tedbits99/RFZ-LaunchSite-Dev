'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Loader2, QrCode, Clock, CheckCircle2, AlertTriangle, RefreshCw, X, Maximize2 } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';

interface QrPhPaymentProps {
  orderReference: string;
  orderEmail: string;
  totalCents: number;
  orderId: string;
  initialStatus: string;
}

const STATUS_PILL: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'text-slate-300 border-slate-500/40 bg-slate-500/10' },
  WAITING_PAYMENT: { label: 'Waiting for Payment', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  PROCESSING: { label: 'Processing', tone: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10' },
  PAID: { label: 'Payment Confirmed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  COMPLETED: { label: 'Payment Confirmed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  DELIVERED: { label: 'Payment Confirmed', tone: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  FAILED: { label: 'Failed', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10' },
  CANCELLED: { label: 'Cancelled', tone: 'text-rose-300 border-rose-400/40 bg-rose-400/10' },
  EXPIRED: { label: 'Expired', tone: 'text-slate-400 border-slate-500/40 bg-slate-500/10' },
  REFUND_PENDING: { label: 'Refund Pending', tone: 'text-amber-300 border-amber-400/40 bg-amber-400/10' },
  REFUNDED: { label: 'Refunded', tone: 'text-violet-300 border-violet-400/40 bg-violet-400/10' },
};

export default function QrPhPayment({
  orderReference,
  orderEmail,
  totalCents,
  orderId,
  initialStatus,
}: QrPhPaymentProps) {
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState(initialStatus);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [expired, setExpired] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState(false);
  const [amountMismatch, setAmountMismatch] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setMounted(true), []);

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

  const createQr = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpired(false);
    setAmountMismatch(false);
    try {
      const res = await fetch('/api/orders/create-qrph-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderReference, email: orderEmail }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || 'Could not create QR Ph payment. Please try again.');
        return;
      }
      if (data.alreadyPaid) {
        setOrderStatus('PAID');
        return;
      }
      if (typeof data.amountCents === 'number' && data.amountCents !== totalCents) {
        setAmountMismatch(true);
        setError('The payment amount does not match your order total. Please refresh the page or contact support.');
        return;
      }
      setQrImageUrl(data.qrImageUrl || null);
      setExpiresAt(data.expiresAt || null);
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [orderReference, orderEmail]);

  // Create QR on mount (idempotent server-side; reopening never re-creates)
  useEffect(() => {
    if (initialStatus === 'WAITING_PAYMENT') {
      void createQr();
    } else {
      setOrderStatus(initialStatus);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription to order status (same behavior as the previous standalone card)
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`order-status-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload: { new: { status?: string } | null }) => {
          const next = (payload.new as { status?: string } | null)?.status;
          if (next && next !== orderStatus) {
            setOrderStatus(next);
            setFlash(true);
            setTimeout(() => setFlash(false), 2500);
          } else if (next) {
            setOrderStatus(next);
          }
        },
      )
      .subscribe((state: string) => {
        setLive(state === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Poll order status every 5 seconds
  useEffect(() => {
    if (orderStatus !== 'WAITING_PAYMENT' || expired) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/orders/qrph-status?orderReference=${encodeURIComponent(orderReference)}&email=${encodeURIComponent(orderEmail)}`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => null);
        if (data?.status && data.status !== orderStatus) {
          setOrderStatus(data.status);
        }
      } catch {
        // silent — realtime subscription also handles this
      }
    };

    pollRef.current = setInterval(poll, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [orderStatus, expired, orderReference, orderEmail]);

  // Countdown timer
  useEffect(() => {
    if (!expiresAt || orderStatus !== 'WAITING_PAYMENT') {
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    const updateCountdown = () => {
      const expiry = new Date(expiresAt).getTime();
      const now = Date.now();
      const diff = Math.floor((expiry - now) / 1000);
      if (diff <= 0) {
        setRemainingSeconds(0);
        setExpired(true);
        if (countdownRef.current) clearInterval(countdownRef.current);
      } else {
        setRemainingSeconds(diff);
      }
    };

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [expiresAt, orderStatus]);

  // Format countdown as MM:SS
  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const isPaid = ['PAID', 'PROCESSING', 'COMPLETED', 'DELIVERED'].includes(orderStatus);
  const isFailed = ['FAILED', 'CANCELLED', 'EXPIRED'].includes(orderStatus);
  const statusPill = STATUS_PILL[orderStatus];
  const showLiveQr = !loading && !error && !expired && !isPaid && !isFailed && qrImageUrl && !amountMismatch;

  const StatusPill = () =>
    statusPill ? (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${statusPill.tone}`}>
        {isPaid && <CheckCircle2 size={12} />}
        {isFailed && <AlertTriangle size={12} />}
        {orderStatus === 'WAITING_PAYMENT' && !expired && <Loader2 size={12} className="animate-spin" />}
        {expired && <Clock size={12} />}
        {statusPill.label}
      </span>
    ) : null;

  const LiveBadge = () => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${
        live ? 'border-emerald-400/30 text-emerald-300' : 'border-slate-500/40 text-slate-500'
      }`}
    >
      {live ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
      {live ? 'Live' : 'Connecting…'}
    </span>
  );

  const QrImage = ({ size }: { size: string }) => (
    <div className="rounded-xl border border-[#253451] bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrImageUrl || ''} alt="Scan to pay with QR Ph" className={`${size} object-contain`} />
    </div>
  );

  const InfoStrip = () => (
    <div className="grid w-full grid-cols-3 gap-2 rounded-xl border border-[#1b2a45] bg-[#080f20] p-3 text-center">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Amount</p>
        <p className="mt-0.5 font-display text-sm font-bold text-cyan-300 sm:text-base">{fmtP(totalCents)}</p>
      </div>
      <div className="border-x border-[#1b2a45]">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Expires in</p>
        <p className={`mt-0.5 font-display text-sm font-bold sm:text-base ${remainingSeconds > 0 && remainingSeconds < 60 ? 'text-amber-300' : 'text-slate-200'}`}>
          {remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '—'}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Order</p>
        <p className="mt-0.5 truncate font-mono text-xs text-slate-300 sm:text-sm">{orderReference}</p>
      </div>
    </div>
  );

  // ---------- Inline section (QR visible by default) ----------

  const inlineSection = (() => {
    // Payment confirmed / terminal states still show the live Order Status block
    if (isPaid) {
      return (
        <div className={`rounded-2xl border p-6 transition-colors duration-700 ${flash ? 'border-cyan-300/60 bg-cyan-400/10' : 'border-emerald-400/25 bg-emerald-400/5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-emerald-300" size={24} />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                <h2 className="font-display text-sm font-bold text-emerald-300">
                  {STATUS_PILL[orderStatus]?.label ?? orderStatus}
                </h2>
                <p className="text-xs text-slate-400">Your QR Ph payment was received. Your order is now being processed.</p>
              </div>
            </div>
            <LiveBadge />
          </div>
        </div>
      );
    }
    if (isFailed) {
      return (
        <div className={`rounded-2xl border p-6 transition-colors duration-700 ${flash ? 'border-cyan-300/60 bg-cyan-400/10' : 'border-rose-400/25 bg-rose-400/5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-rose-300" size={24} />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                <h2 className="font-display text-sm font-bold text-rose-300">
                  {STATUS_PILL[orderStatus]?.label ?? orderStatus}
                </h2>
                <p className="text-xs text-slate-400">The QR Ph payment was not completed. Please try again.</p>
              </div>
            </div>
            <LiveBadge />
          </div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-cyan-300" />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                <h2 className="font-display text-sm font-semibold text-cyan-300">Scan to Pay with QR Ph</h2>
                <p className="text-xs text-slate-400">Preparing your QR code…</p>
              </div>
            </div>
            <LiveBadge />
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-400/5 p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-rose-300" size={20} />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                <h2 className="font-display text-sm font-semibold text-rose-300">QR Ph Payment</h2>
                <p className="flex-1 text-xs text-rose-300">{error}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <LiveBadge />
              <button
                type="button"
                onClick={() => { void createQr(); }}
                className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10"
              >
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (expired) {
      return (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Clock className="text-amber-300" size={24} />
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Order Status</p>
                <h2 className="font-display text-sm font-semibold text-amber-300">QR Code Expired</h2>
                <p className="text-xs text-slate-400">The QR code has expired. Generate a new one to try again.</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <LiveBadge />
              <button
                type="button"
                onClick={() => { void createQr(); }}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                New QR
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Live waiting-for-payment state: QR visible by default
    return (
      <div className={`rounded-2xl border p-6 sm:p-8 transition-colors duration-700 ${flash ? 'border-cyan-300/60 bg-cyan-400/10' : 'border-cyan-400/20 bg-cyan-400/5'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <QrCode className="text-cyan-300" size={22} />
            <div>
              <h2 className="font-display text-sm font-semibold text-cyan-300">Scan to Pay with QR Ph</h2>
              <p className="text-xs text-slate-400">Open your banking or e-wallet app and scan the code below.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill />
            <LiveBadge />
            {showLiveQr && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                aria-label="Enlarge QR code"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#253451] px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300"
              >
                <Maximize2 size={13} /> Enlarge
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center">
          <QrImage size="h-56 w-56 sm:h-64 sm:w-64" />
          <div className="mt-5 w-full max-w-sm">
            <InfoStrip />
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2.5">
            <Loader2 size={14} className="animate-spin text-amber-300" />
            <p className="text-xs text-amber-300">Waiting for payment…</p>
          </div>
          <p className="mt-3 max-w-xs text-center text-[10px] leading-relaxed text-slate-500">
            Keep this page open — your payment is tracked automatically and the status updates in real time.
          </p>
        </div>
      </div>
    );
  })();

  // ---------- Optional enlarged modal ----------

  const modal =
    mounted && modalOpen
      ? createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true">
            <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#253451] bg-[#0b1225] p-4 shadow-2xl sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold">Scan to Pay with QR Ph</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Order <span className="font-mono text-cyan-300">{orderReference}</span></p>
                </div>
                <button type="button" onClick={() => setModalOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-[#253451] text-slate-400 transition hover:border-rose-400 hover:text-rose-300">
                  <X size={15} />
                </button>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <StatusPill />
                <LiveBadge />
              </div>

              {isPaid ? (
                <>
                  <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-6">
                    <div className="flex flex-col items-center py-2 text-center">
                      <CheckCircle2 className="text-emerald-300" size={40} />
                      <h3 className="mt-3 font-display text-sm font-semibold text-emerald-300">Payment Confirmed</h3>
                      <p className="mt-1 text-xs text-slate-400">Your QR Ph payment was received. Your order is now being processed.</p>
                      <p className="mt-3 font-display text-lg font-bold text-cyan-300">{fmtP(totalCents)}</p>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => setModalOpen(false)} className="flex-1 rounded-xl border border-[#253451] px-4 py-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500">
                      Close
                    </button>
                    <a href={`/track-order?ref=${encodeURIComponent(orderReference)}&email=${encodeURIComponent(orderEmail)}`} className="flex-[2] rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3 text-center text-xs font-bold shadow-lg shadow-blue-900/30 transition hover:brightness-110">
                      Track Order
                    </a>
                  </div>
                </>
              ) : isFailed || expired ? (
                <>
                  <div className={`mt-4 rounded-2xl border p-6 ${isFailed ? 'border-rose-400/25 bg-rose-400/5' : 'border-amber-400/25 bg-amber-400/5'}`}>
                    <div className="flex flex-col items-center py-2 text-center">
                      {isFailed ? <AlertTriangle className="text-rose-300" size={40} /> : <Clock className="text-amber-300" size={40} />}
                      <h3 className={`mt-3 font-display text-sm font-semibold ${isFailed ? 'text-rose-300' : 'text-amber-300'}`}>
                        {isFailed ? 'Payment Failed' : 'QR Code Expired'}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {isFailed ? 'The QR Ph payment was not completed. Please try again.' : 'The QR code has expired. Generate a new one to try again.'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => setModalOpen(false)} className="flex-1 rounded-xl border border-[#253451] px-4 py-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500">
                      Close
                    </button>
                    <button type="button" onClick={() => { void createQr(); }} disabled={loading} className="flex-[2] rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3 text-xs font-bold shadow-lg shadow-blue-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                      {loading ? <Loader2 size={14} className="mx-auto animate-spin" /> : <span className="inline-flex items-center justify-center gap-2"><RefreshCw size={14} /> {isFailed ? 'Try Again' : 'New QR'}</span>}
                    </button>
                  </div>
                </>
              ) : loading ? (
                <div className="mt-4 flex flex-col items-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
                  <p className="mt-3 text-sm text-slate-400">Generating your QR Ph code…</p>
                </div>
              ) : error ? (
                <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/5 p-6">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="text-rose-300" size={20} />
                    <p className="flex-1 text-xs text-rose-300">{error}</p>
                    <button
                      type="button"
                      onClick={() => { void createQr(); }}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10"
                    >
                      <RefreshCw size={14} /> Retry
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-5 flex flex-col items-center">
                    <QrImage size="h-64 w-64 sm:h-72 sm:w-72" />
                    <div className="mt-5 w-full">
                      <InfoStrip />
                    </div>
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2.5">
                      <Loader2 size={14} className="animate-spin text-amber-300" />
                      <p className="text-xs text-amber-300">Waiting for payment…</p>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => setModalOpen(false)} className="flex-1 rounded-xl border border-[#253451] px-4 py-3 text-xs font-semibold text-slate-300 transition hover:border-slate-500">
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {inlineSection}
      {modal}
    </>
  );
}

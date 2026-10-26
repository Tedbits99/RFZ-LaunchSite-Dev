'use client';
import { useState, useEffect, useCallback } from 'react';
import { Search, Package, CheckCircle2, Clock, XCircle, Circle, RefreshCw } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import ThemeSelector from '@/components/ThemeSelector';

type TimelineEntry = { id: string; status: string; note: string; created_at: string };
type Order = { id: string; reference: string; status: string; total_cents: number; created_at: string; updated_at: string; payment_method: string; games?: { name: string } | null; packages?: { name: string } | null };

const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
const fmtTime = (s: string) => new Date(s).toLocaleString();

const statusColor: Record<string, string> = {
  PENDING: 'text-slate-300',
  WAITING_PAYMENT: 'text-amber-300',
  PAID: 'text-emerald-300',
  PROCESSING: 'text-blue-300',
  COMPLETED: 'text-emerald-400',
  DELIVERED: 'text-cyan-300',
  FAILED: 'text-red-400',
  EXPIRED: 'text-zinc-400',
  CANCELLED: 'text-rose-300',
  REFUND_PENDING: 'text-orange-300',
  REFUNDED: 'text-slate-400',
};

const statusLabel: Record<string, string> = {
  PENDING: 'Order Received',
  WAITING_PAYMENT: 'Waiting for Payment',
  PAID: 'Payment Confirmed',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund Requested',
  REFUNDED: 'Refunded',
};

const statusDesc: Record<string, string> = {
  PENDING: 'Your order has been received',
  WAITING_PAYMENT: 'Payment confirmation pending',
  PAID: 'Payment confirmed',
  PROCESSING: 'Your order is being processed',
  COMPLETED: 'Fulfillment completed',
  DELIVERED: 'Your credits/item have been delivered',
  FAILED: 'Order processing failed',
  EXPIRED: 'Order has expired',
  CANCELLED: 'Order cancelled',
  REFUND_PENDING: 'Refund is being processed',
  REFUNDED: 'Refund completed',
};

const FLOW_STEPS = ['PENDING', 'WAITING_PAYMENT', 'PAID', 'PROCESSING', 'COMPLETED'];

export default function TrackOrder() {
  const [ref, setRef] = useState('');
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [accessRequested, setAccessRequested] = useState(false);

  useEffect(() => {
    const initialReference = new URLSearchParams(window.location.search).get('ref');
    if (initialReference) setRef(initialReference.toUpperCase());
  }, []);

  const search = async () => {
    setError(''); setOrder(null); setTimeline([]); setLoading(true);
    try {
      const res = await fetch('/api/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: ref.toUpperCase(), email }),
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data.order) { setError(data.error || 'No order found. Check your reference and email.'); setLoading(false); return; }
      setOrder(data.order);
      setTimeline(data.timeline || []);
    } catch {
      setError('Could not reach the server. Please try again.');
    }
    setLoading(false);
  };

  const requestAccessCode = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/orders/access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order recovery is unavailable.');
      setAccessRequested(true);
      setError(data.message || 'If the order details match, an access code will be sent to the checkout email.');
    } catch {
      setError('If the order details match, an access code will be sent to the checkout email.');
    }
    setLoading(false);
  };

  const verifyAccessCode = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/orders/access/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref, email, code: accessCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'The recovery code is invalid or expired.');
      setAccessCode('');
      await search();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'The recovery code is invalid or expired.');
      setLoading(false);
    }
  };

  // Poll for status updates every 5 seconds once an order is found
  const poll = useCallback(async () => {
    if (!order) return;
    try {
      const res = await fetch(`/api/orders/${order.id}/status-check`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status && data.status !== order.status) {
        setOrder((prev) => prev ? { ...prev, status: data.status, updated_at: data.updated_at } : prev);
      }
      if (data.timeline) setTimeline(data.timeline);
    } catch { /* silent */ }
  }, [order, email]);

  useEffect(() => {
    if (!order) return;
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [order, poll]);

  const currentStepIdx = order ? FLOW_STEPS.indexOf(order.status) : -1;
  const isFailed = order?.status === 'FAILED' || order?.status === 'EXPIRED';
  const isCancelled = order?.status === 'CANCELLED';
  const isRefundFlow = order?.status === 'REFUND_PENDING' || order?.status === 'REFUNDED';

  return (
    <main className="rfz-track-page min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-4"><a href="/" className="text-xs text-cyan-300">← Back to store</a><ThemeSelector /></div></header>
      <div className="mx-auto max-w-2xl px-5 py-16">
        <h1 className="font-display text-3xl font-bold">Track Your Order</h1>
        <p className="mt-2 text-sm text-slate-400">Enter your order reference and email to check status.</p>
        <div className="mt-8 space-y-3">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-300">Order reference</span><input id="order-reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. RF-20260928-000001" autoComplete="off" aria-describedby="order-reference-hint" className="rfz-input w-full px-4 py-3 text-sm" /><span id="order-reference-hint" className="mt-1 block text-[11px] text-slate-500">Use the reference from your confirmation email.</span></label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-300">Checkout email</span><input id="tracking-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email used at checkout" autoComplete="email" className="rfz-input w-full px-4 py-3 text-sm" /></label>
          <button onClick={search} disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50"><Search size={15} /> {loading ? 'Searching...' : 'Track Order'}</button>
          <button onClick={requestAccessCode} disabled={loading || !ref || !email} className="w-full rounded-lg border border-[#22314d] py-3 text-sm text-slate-300 disabled:opacity-50">Email me a one-time access code</button>
          {accessRequested && <div className="space-y-2">
            <input value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="One-time code from your email" autoComplete="one-time-code" className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-4 py-3 text-sm outline-none focus:border-cyan-400" />
            <button onClick={verifyAccessCode} disabled={loading || !accessCode} className="w-full rounded-lg bg-slate-800 py-3 text-sm font-semibold disabled:opacity-50">{loading ? 'Verifying...' : 'Verify and track order'}</button>
          </div>}
          {error && <p role="alert" aria-live="polite" className="rounded-lg border border-rose-400/25 bg-rose-400/5 p-3 text-sm text-rose-300">{error}</p>}
        </div>

        {order && (
          <div className="mt-8 space-y-5">
            {/* Order summary */}
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
              <div className="flex items-center gap-3">
                <Package className="text-cyan-300" size={20} />
                <div>
                  <p className="font-mono text-sm text-cyan-300">{order.reference}</p>
                  <p className="text-xs text-slate-400">{order.games?.name} · {order.packages?.name}</p>
                </div>
                <span className={`ml-auto text-sm font-semibold ${statusColor[order.status] || 'text-slate-300'}`}>{order.status}</span>
              </div>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Payment Method</span><span className="capitalize">{order.payment_method}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Created</span><span>{fmtTime(order.created_at)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Last Updated</span><span>{fmtTime(order.updated_at)}</span></div>
                <div className="flex justify-between border-t border-[#1b2a45] pt-3"><span className="text-slate-400">Total</span><span className="font-display font-bold text-cyan-300">{fmtP(order.total_cents)}</span></div>
              </div>
            </div>

            {order.status === 'WAITING_PAYMENT' && (
              <a href={`/checkout?ref=${encodeURIComponent(order.reference)}`} className="block rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-4 py-3 text-center text-sm font-semibold text-cyan-200 hover:border-cyan-300">
                View payment instructions and submit proof
              </a>
            )}

            {/* Status progress */}
            {!isCancelled && !isRefundFlow && !isFailed && (
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-4"><RefreshCw size={12} className="animate-spin-slow" /> Live status updates automatically</div>
                <div className="space-y-1">
                  {FLOW_STEPS.map((step, idx) => {
                    const isDone = currentStepIdx > idx;
                    const isCurrent = currentStepIdx === idx;
                    const Icon = isDone ? CheckCircle2 : isCurrent ? Clock : Circle;
                    const color = isDone ? 'text-emerald-400' : isCurrent ? 'text-amber-300' : 'text-slate-600';
                    return (
                      <div key={step} className="flex items-center gap-3">
                        <Icon size={16} className={color} />
                        <div className="flex-1">
                          <span className={`text-sm font-medium ${isDone ? 'text-slate-300' : isCurrent ? 'text-amber-300' : 'text-slate-600'}`}>{statusLabel[step]}</span>
                          {isCurrent && <p className="text-[11px] text-slate-500">{statusDesc[step]}</p>}
                        </div>
                        {isDone && <span className="text-[10px] text-emerald-400">✓</span>}
                        {isCurrent && <span className="text-[10px] text-amber-300">●</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Failed / Expired */}
            {isFailed && (
              <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-6">
                <div className="flex items-center gap-3"><XCircle className={order?.status === 'EXPIRED' ? 'text-zinc-400' : 'text-red-400'} size={20} /><div><p className={`text-sm font-semibold ${order?.status === 'EXPIRED' ? 'text-zinc-300' : 'text-red-300'}`}>{statusLabel[order?.status || ''] || order?.status}</p><p className="text-xs text-slate-500">{statusDesc[order?.status || '']}</p></div></div>
              </div>
            )}

            {/* Cancelled */}
            {isCancelled && (
              <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-6">
                <div className="flex items-center gap-3"><XCircle className="text-rose-400" size={20} /><div><p className="text-sm font-semibold text-rose-300">Order Cancelled</p><p className="text-xs text-slate-500">This order has been cancelled.</p></div></div>
              </div>
            )}

            {/* Refund flow */}
            {isRefundFlow && (
              <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-6">
                <div className="space-y-3">
                  <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Order Created</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Payment Confirmed</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Processing</span></div>
                  <div className="flex items-center gap-3"><CheckCircle2 className="text-orange-400" size={16} /><span className="text-sm text-orange-300">Refund Requested</span></div>
                  {order.status === 'REFUNDED' && <div className="flex items-center gap-3"><CheckCircle2 className="text-slate-400" size={16} /><span className="text-sm text-slate-400">Refunded</span></div>}
                </div>
              </div>
            )}

            {/* Timeline */}
            {timeline.length > 0 && (
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
                <h2 className="font-display text-sm font-semibold mb-4">Order Timeline</h2>
                <div className="space-y-3">
                  {timeline.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {entry.status === 'CANCELLED' || entry.status === 'REFUNDED' ? <XCircle size={14} className="text-rose-400" /> : entry.status === 'COMPLETED' || entry.status === 'DELIVERED' || entry.status === 'PAID' ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Clock size={14} className="text-amber-300" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold ${statusColor[entry.status] || 'text-slate-400'}`}>{entry.status}</span>
                          <span className="text-[10px] text-slate-600">{fmtTime(entry.created_at)}</span>
                        </div>
                        {entry.note && <p className="mt-0.5 text-[11px] text-slate-500">{entry.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}

'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ShoppingCart, Clock, CheckCircle2, XCircle, ArrowUpRight, X, RefreshCw, Archive } from 'lucide-react';

type Order = { id: string; reference: string; email: string; status: string; total_cents: number; created_at: string; payment_status?: string; fulfillment_status?: string; games?: { name: string } | null; packages?: { name: string } | null; supplier_transactions?: { supplier_reference: string | null; status: string; suppliers?: { code: string; name: string } | null }[] | null };
type TimelineEntry = { id: string; status: string; actor_email: string; note: string; created_at: string };
type PaymentSubmission = {
  id: string;
  payment_method: string;
  reference_number: string;
  amount_cents: number;
  note: string;
  proof_url: string | null;
  submitted_at: string;
};
type SupplierTransaction = {
  id: string;
  supplier_id: string;
  supplier_reference: string | null;
  status: string;
  action: string;
  error_message: string | null;
  created_at: string;
  last_polled_at: string | null;
  suppliers: { code: string; name: string } | null;
};
type OrderDetail = {
  id: string;
  reference: string;
  email: string;
  customer_name: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  payment_verification_method: string | null;
  payment_verified_at: string | null;
  payment_verified_by: string | null;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  payment_mode: string;
  player_inputs: Record<string, string>;
  voucher_code: string | null;
  games?: { name: string } | null;
  packages?: { name: string } | null;
  timeline: TimelineEntry[];
  paymentSubmission?: PaymentSubmission | null;
  supplierTransaction?: SupplierTransaction | null;
};

const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;

const statusColor: Record<string, string> = {
  PENDING: 'text-slate-300',
  WAITING_PAYMENT: 'text-amber-300',
  PAYMENT_VERIFIED: 'text-teal-300',
  PAID: 'text-emerald-300',
  PROCESSING: 'text-blue-300',
  COMPLETED: 'text-emerald-400',
  DELIVERED: 'text-cyan-300',
  FULFILLMENT_FAILED: 'text-red-400',
  FAILED: 'text-red-400',
  EXPIRED: 'text-zinc-400',
  CANCELLED: 'text-rose-300',
  REFUND_PENDING: 'text-orange-300',
  REFUNDED: 'text-slate-400',
};

const statuses = ['ALL', 'PENDING', 'WAITING_PAYMENT', 'PAYMENT_VERIFIED', 'PAID', 'PROCESSING', 'COMPLETED', 'FULFILLMENT_FAILED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED'];

const ORDER_STATUSES = ['PAYMENT_VERIFIED', 'CANCELLED'];

const supplierTxLabel = (s: string) =>
  s === 'pending' ? 'Pending'
  : s === 'submitted' ? 'Submitted'
  : s === 'success' ? 'Completed'
  : s === 'failed' ? 'Failed'
  : s === 'timeout' ? 'Timeout'
  : s;

const statusBadge: Record<string, string> = {
  PENDING: 'bg-slate-500/20 text-slate-300',
  WAITING_PAYMENT: 'bg-amber-500/20 text-amber-300',
  PAYMENT_VERIFIED: 'bg-teal-500/20 text-teal-300',
  PAID: 'bg-emerald-500/20 text-emerald-300',
  PROCESSING: 'bg-blue-500/20 text-blue-300',
  COMPLETED: 'bg-emerald-500/20 text-emerald-400',
  DELIVERED: 'bg-cyan-500/20 text-cyan-300',
  FULFILLMENT_FAILED: 'bg-red-500/20 text-red-400',
  FAILED: 'bg-red-500/20 text-red-400',
  EXPIRED: 'bg-zinc-500/20 text-zinc-400',
  CANCELLED: 'bg-rose-500/20 text-rose-300',
  REFUND_PENDING: 'bg-orange-500/20 text-orange-300',
  REFUNDED: 'bg-slate-500/20 text-slate-400',
};

export default function OrdersManager({
  orders,
  dbReady,
  searchParams,
  statusCounts = {},
}: {
  orders: Order[];
  dbReady: boolean;
  searchParams: { q?: string; status?: string; date?: string; archived?: string };
  statusCounts?: Record<string, number>;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [retryingFulfillment, setRetryingFulfillment] = useState(false);
  const [startingFulfillment, setStartingFulfillment] = useState(false);
  const [pollingSupplier, setPollingSupplier] = useState(false);
  const [liveOrders, setLiveOrders] = useState<Order[]>(orders);
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>(statusCounts);
  const [refreshing, setRefreshing] = useState(false);
  const [autoInterval, setAutoInterval] = useState<number>(0); // 0 = off
  const refreshingRef = useRef(false);

  const refreshData = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (searchParams.q) params.set('q', searchParams.q);
      if (searchParams.status) params.set('status', searchParams.status);
      if (searchParams.date) params.set('date', searchParams.date);
      if (searchParams.archived === '1') params.set('archived', '1');
      const res = await fetch(`/api/admin/orders?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data) {
        setLiveOrders((data.orders || []) as Order[]);
        setLiveCounts(data.statusCounts || {});
      }
    } catch {
      // silent — next tick will retry
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [searchParams.q, searchParams.status, searchParams.date, searchParams.archived]);

  useEffect(() => { setLiveOrders(orders); }, [orders]);
  useEffect(() => { setLiveCounts(statusCounts); }, [statusCounts]);

  useEffect(() => {
    if (autoInterval <= 0) return;
    const id = window.setInterval(() => { void refreshData(); }, autoInterval * 1000);
    return () => window.clearInterval(id);
  }, [autoInterval, refreshData]);

  const openOrder = async (id: string) => {
    setDetailLoading(true);
    setDetailError('');
    try {
      const res = await fetch(`/api/admin/orders/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setDetailError(data.error || 'Could not load this order.');
        return;
      }
      setDetail({ ...data.order, timeline: data.timeline, paymentSubmission: data.paymentSubmission || null, supplierTransaction: data.supplierTransaction || null });
    } catch {
      setDetailError('Could not load this order.');
    } finally {
      setDetailLoading(false);
    }
  };

  const applyStatus = async () => {
    if (!detail || !newStatus || newStatus === detail.status) return;
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      const res = await fetch(`/api/admin/orders/${detail.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, note: statusNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Failed to update status.');
        return;
      }
      setDetail((d) => (d ? { ...d, status: data.status, timeline: [{ id: `new-${Date.now()}`, status: data.status, actor_email: 'admin', note: statusNote, created_at: new Date().toISOString() }, ...d.timeline] } : d));
      setSaveMessage(`Status changed to ${data.status}`);
      setNewStatus('');
      setStatusNote('');
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const total = Object.values(liveCounts).reduce((a, b) => a + b, 0);
  const pending = liveCounts['PENDING'] || 0;
  const waiting = liveCounts['WAITING_PAYMENT'] || 0;
  const paymentVerified = liveCounts['PAYMENT_VERIFIED'] || 0;
  const paid = liveCounts['PAID'] || 0;
  const processing = liveCounts['PROCESSING'] || 0;
  const completed = liveCounts['COMPLETED'] || 0;
  const fulfillmentFailed = liveCounts['FULFILLMENT_FAILED'] || 0;
  const failed = liveCounts['FAILED'] || 0;
  const expired = liveCounts['EXPIRED'] || 0;
  const cancelled = liveCounts['CANCELLED'] || 0;
  const refundPending = liveCounts['REFUND_PENDING'] || 0;
  const refunded = liveCounts['REFUNDED'] || 0;

  const cards = [
    { label: 'Total', value: total, icon: ShoppingCart, color: 'text-blue-300' },
    { label: 'Pending', value: pending, icon: Clock, color: 'text-slate-300' },
    { label: 'Waiting Payment', value: waiting, icon: Clock, color: 'text-amber-300' },
    { label: 'Payment Verified', value: paymentVerified, icon: CheckCircle2, color: 'text-teal-300' },
    { label: 'Paid', value: paid, icon: CheckCircle2, color: 'text-emerald-300' },
    { label: 'Processing', value: processing, icon: ArrowUpRight, color: 'text-blue-300' },
    { label: 'Completed', value: completed, icon: CheckCircle2, color: 'text-emerald-400' },
    { label: 'Fulfillment Failed', value: fulfillmentFailed, icon: XCircle, color: 'text-red-400' },
    { label: 'Failed', value: failed, icon: XCircle, color: 'text-red-400' },
    { label: 'Expired', value: expired, icon: Clock, color: 'text-zinc-400' },
    { label: 'Cancelled', value: cancelled, icon: XCircle, color: 'text-rose-300' },
    { label: 'Refund Pending', value: refundPending, icon: Clock, color: 'text-orange-300' },
    { label: 'Refunded', value: refunded, icon: CheckCircle2, color: 'text-slate-400' },
  ];

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-xs text-slate-400 hover:text-cyan-300">← Dashboard</Link>
            <span className="text-slate-600">/</span>
            <span className="text-sm font-semibold">Orders</span>
          </div>
          <Link href="/" className="text-xs text-slate-400">View Store</Link>
        </div>
      </header>
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-2xl font-bold">Orders</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshData()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-cyan-400 hover:text-cyan-300 disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Auto</span>
              <select
                value={autoInterval}
                onChange={(e) => setAutoInterval(Number(e.target.value))}
                className="rounded-lg border border-[#22314d] bg-[#0a1124] px-2 py-2 text-xs text-slate-300"
              >
                <option value={0}>Off</option>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </label>
          </div>
        </div>

        {/* Status summary cards */}
        <div className="mt-4 flex flex-wrap gap-2">
          {cards.map((c) => (
            <div key={c.label} className="min-w-[110px] flex-1 rounded-lg border border-[#1b2a45] bg-[#0b1225] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}</span>
                <c.icon size={12} className={c.color} />
              </div>
              <p className="mt-2 font-display text-xl font-bold">{c.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <form className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3" action="/admin/orders" method="GET">
            {searchParams.archived === '1' && <input type="hidden" name="archived" value="1" />}
            <Search size={15} className="text-slate-500" />
            <input name="q" defaultValue={searchParams.q || ''} placeholder="Search reference or email" className="w-56 bg-transparent py-2 text-sm outline-none" />
          </form>
          <form className="flex items-center gap-2" action="/admin/orders" method="GET">
            {searchParams.q && <input type="hidden" name="q" value={searchParams.q} />}
            {searchParams.archived === '1' && <input type="hidden" name="archived" value="1" />}
            <select name="status" defaultValue={searchParams.status || 'ALL'} className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300" onChange={(e) => e.currentTarget.form?.submit()}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </form>
          <form className="flex items-center gap-2" action="/admin/orders" method="GET">
            {searchParams.q && <input type="hidden" name="q" value={searchParams.q} />}
            {searchParams.status && searchParams.status !== 'ALL' && <input type="hidden" name="status" value={searchParams.status} />}
            {searchParams.archived === '1' && <input type="hidden" name="archived" value="1" />}
            <input type="date" name="date" defaultValue={searchParams.date || ''} className="rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300" onChange={(e) => e.currentTarget.form?.submit()} />
          </form>
          <a
            href={searchParams.archived === '1' ? '/admin/orders' : '/admin/orders?archived=1'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition ${searchParams.archived === '1' ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-[#22314d] bg-[#0a1124] text-slate-400 hover:border-cyan-400 hover:text-cyan-300'}`}
          >
            <Archive size={13} />
            {searchParams.archived === '1' ? 'Viewing Archived' : 'Archived'}
          </a>
        </div>

        {/* Orders table */}
        {!dbReady ? (
          <p className="mt-8 text-sm text-slate-500">Database not configured. Orders will appear here once connected.</p>
        ) : (
          <>
          <div className="mt-6 space-y-3 md:hidden">
            {liveOrders.length === 0 && <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-8 text-center text-sm text-slate-600">No orders found.</div>}
            {liveOrders.map((o) => (
              <article key={`mobile-${o.id}`} className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-4 shadow-lg shadow-black/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-cyan-300">{o.reference}</p>
                    <p className="mt-1 text-sm font-medium text-slate-200">{o.games?.name || 'Game order'}</p>
                    <p className="mt-1 text-xs text-slate-500">{o.email}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${statusBadge[o.status] || 'bg-slate-500/20 text-slate-400'}`}>{o.status.replaceAll('_', ' ')}</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#172541] pt-3 text-xs">
                  <div><p className="text-[10px] uppercase tracking-wide text-slate-600">Payment</p><p className="mt-1 text-slate-300">{o.payment_status || '—'}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wide text-slate-600">Fulfillment</p><p className="mt-1 text-slate-300">{o.fulfillment_status || '—'}</p></div>
                  <div className="text-right"><p className="text-[10px] uppercase tracking-wide text-slate-600">Total</p><p className="mt-1 font-semibold text-cyan-200">{fmtP(o.total_cents)}</p></div>
                </div>
                <button type="button" onClick={() => { setNewStatus(''); setStatusNote(''); setSaveMessage(''); setSaveError(''); openOrder(o.id); }} className="mt-4 w-full rounded-lg border border-cyan-400/30 bg-cyan-400/5 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-400/10">Open order details</button>
              </article>
            ))}
          </div>

          <div className="mt-6 hidden overflow-x-auto rounded-xl border border-[#1b2a45] bg-[#0b1225] md:block">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-[#1b2a45]">
                  <th className="p-4 font-medium">Reference</th>
                  <th className="p-4 font-medium">Customer</th>
                  <th className="p-4 font-medium">Game</th>
                  <th className="p-4 font-medium">Package</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Payment</th>
                  <th className="p-4 font-medium">Fulfillment</th>
                  <th className="p-4 font-medium">Supplier</th>
                  <th className="p-4 font-medium">Sup. Ref</th>
                  <th className="p-4 text-right font-medium">Total</th>
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {liveOrders.length === 0 && <tr><td colSpan={12} className="p-6 text-center text-slate-600">No orders found.</td></tr>}
                {liveOrders.map((o) => (
                  <tr key={o.id} className="border-b border-[#0f1b31] hover:bg-[#0f1a33]">
                    <td className="p-4 font-mono text-cyan-300">{o.reference}</td>
                    <td className="p-4 text-slate-300">{o.email}</td>
                    <td className="p-4 text-slate-400">{o.games?.name || '—'}</td>
                    <td className="p-4 text-slate-400">{o.packages?.name || '—'}</td>
                    <td className="p-4">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge[o.status] || 'bg-slate-500/20 text-slate-400'}`}>{o.status}</span>
                    </td>
                    <td className="p-4"><span className="text-[10px] text-slate-400">{o.payment_status || '—'}</span></td>
                    <td className="p-4"><span className="text-[10px] text-slate-400">{o.fulfillment_status || '—'}</span></td>
                    <td className="p-4"><span className="text-[10px] text-slate-300">{o.supplier_transactions?.[0]?.suppliers?.code || '—'}</span></td>
                    <td className="p-4"><span className="font-mono text-[10px] text-cyan-300">{o.supplier_transactions?.[0]?.supplier_reference || '—'}</span></td>
                    <td className="p-4 text-right font-medium">{fmtP(o.total_cents)}</td>
                    <td className="p-4 text-slate-500">{new Date(o.created_at).toLocaleDateString()}</td>
                    <td className="p-4">
                      <button type="button" onClick={() => { setNewStatus(''); setStatusNote(''); setSaveMessage(''); setSaveError(''); openOrder(o.id); }} className="text-cyan-300 hover:underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}

        {detail && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[90vh] w-full max-w-[680px] overflow-y-auto rounded-xl border border-[#2b3c5c] bg-[#0b1225] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">Order Details</h2>
                <p className="mt-1 font-mono text-xs text-cyan-300">{detail.reference}</p>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-slate-500 transition hover:text-slate-300"><X size={20} /></button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs text-slate-500">Customer</p><p className="text-sm">{detail.customer_name || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Email</p><p className="text-sm text-slate-300">{detail.email}</p></div>
              <div><p className="text-xs text-slate-500">Game</p><p className="text-sm">{detail.games?.name || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Package</p><p className="text-sm">{detail.packages?.name || '—'}</p></div>
              <div><p className="text-xs text-slate-500">Payment Method</p><p className="text-sm capitalize">{detail.payment_mode === 'automated' ? 'Automated' : 'Manual'}</p></div>
              <div><p className="text-xs text-slate-500">Order Status</p><p className="text-sm font-bold text-amber-300">{detail.status}</p></div>
              <div><p className="text-xs text-slate-500">Payment Status</p><p className="text-sm font-bold text-emerald-300">{detail.payment_status}</p></div>
              <div><p className="text-xs text-slate-500">Fulfillment</p><p className="text-sm font-bold text-blue-300">{detail.fulfillment_status}</p></div>
              {detail.payment_verification_method && <div><p className="text-xs text-slate-500">Verification</p><p className="text-sm text-slate-400">{detail.payment_verification_method === 'MANUAL' ? 'Manual — Super Admin' : 'Automatic'}</p></div>}
              {detail.payment_verified_by && <div><p className="text-xs text-slate-500">Verified By</p><p className="text-sm text-slate-400">{detail.payment_verified_by}</p></div>}
            </div>

            {Object.keys(detail.player_inputs || {}).length > 0 && <div className="mt-4 rounded-lg border border-[#1b2a45] p-3">
              <p className="text-xs text-slate-500">Player Information</p>
              <div className="mt-2 grid gap-1 text-xs text-slate-200">
                {Object.entries(detail.player_inputs).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
              </div>
            </div>}

            {detail.paymentSubmission && (
              <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-4">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-300" />
                  <p className="text-xs font-semibold text-amber-300">Payment Submission — Awaiting Verification</p>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-slate-500">Method: </span><span className="capitalize">{detail.paymentSubmission.payment_method}</span></div>
                  <div><span className="text-slate-500">Reference: </span><span className="text-cyan-300">{detail.paymentSubmission.reference_number || '—'}</span></div>
                  <div><span className="text-slate-500">Amount: </span><span>{fmtP(detail.paymentSubmission.amount_cents)}</span></div>
                  <div><span className="text-slate-500">Submitted: </span><span>{new Date(detail.paymentSubmission.submitted_at).toLocaleString()}</span></div>
                </div>
                {detail.paymentSubmission.note && <div className="mt-2 rounded-lg border border-[#1b2a45] p-2 text-[11px] text-slate-400">{detail.paymentSubmission.note}</div>}
                {detail.paymentSubmission.proof_url && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs text-slate-500">Payment Proof Screenshot:</p>
                                        <img
                      src={detail.paymentSubmission.proof_url}
                      alt="Payment proof"
                      className="max-h-48 cursor-pointer rounded-lg border border-[#253451] transition hover:border-cyan-400"
                      onClick={() => {
                        const w = window.open('', '_blank');
                        if (w) { w.document.write(`<img src="${detail.paymentSubmission!.proof_url}" style="max-width:100%;height:auto;background:#0b1225" alt="Payment proof" />`); w.document.title = 'Payment Proof'; }
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {detail.supplierTransaction && (
              <div className="mt-4 rounded-lg border border-[#1b2a45] bg-[#0a1124] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-300">Supplier Fulfillment</p>
                  <button
                    type="button"
                    onClick={async () => {
                      setPollingSupplier(true);
                      setSaveError('');
                      setSaveMessage('');
                      try {
                        const res = await fetch(`/api/admin/orders/${detail.id}/poll-supplier-status`, { method: 'POST' });
                        const data = await res.json();
                        if (!res.ok) { setSaveError(data.error || 'Poll failed.'); return; }
                        await openOrder(detail.id);
                        setSaveMessage(data.fulfillment_status === 'COMPLETED' ? 'Supplier confirmed completion.' : data.fulfillment_status === 'FAILED' ? 'Supplier reported failure.' : 'Supplier still processing.');
                      } catch { setSaveError('Could not reach the server.'); }
                      finally { setPollingSupplier(false); }
                    }}
                    disabled={pollingSupplier}
                    className="rounded-lg border border-[#22314d] bg-[#0b1225] px-3 py-1 text-[10px] font-medium text-cyan-300 hover:bg-[#0f1a33] disabled:opacity-40"
                  >
                    {pollingSupplier ? <RefreshCw size={11} className="mx-auto animate-spin" /> : 'Poll Supplier'}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-slate-500">Supplier: </span><span>{detail.supplierTransaction.suppliers?.name || detail.supplierTransaction.suppliers?.code || '—'}</span></div>
                  <div><span className="text-slate-500">Tx Status: </span><span>{supplierTxLabel(detail.supplierTransaction.status)}</span></div>
                  <div><span className="text-slate-500">Supplier Ref: </span><span className="font-mono text-cyan-300">{detail.supplierTransaction.supplier_reference || '—'}</span></div>
                  <div><span className="text-slate-500">Created: </span><span>{new Date(detail.supplierTransaction.created_at).toLocaleString()}</span></div>
                  <div><span className="text-slate-500">Last Polled: </span><span>{detail.supplierTransaction.last_polled_at ? new Date(detail.supplierTransaction.last_polled_at).toLocaleString() : 'Never'}</span></div>
                </div>
                {detail.supplierTransaction.error_message && <div className="mt-2 rounded-lg border border-rose-400/20 p-2 text-[11px] text-rose-300">{detail.supplierTransaction.error_message}</div>}
              </div>
            )}

            <div className="mt-5 space-y-1 border-t border-[#1b2a45] pt-4 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{fmtP(detail.subtotal_cents)}</span></div>
              {detail.discount_cents > 0 && <div className="flex justify-between text-emerald-300"><span>Voucher ({detail.voucher_code})</span><span>-{fmtP(detail.discount_cents)}</span></div>}
              <div className="flex justify-between font-bold"><span className="text-slate-300">Total</span><span className="text-cyan-300">{fmtP(detail.total_cents)}</span></div>
            </div>

            <div className="mt-5 border-t border-[#1b2a45] pt-4">
              <p className="text-xs font-semibold text-slate-300">Update Status</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="flex-1 rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300">
                  <option value="">Select status...</option>
                  {ORDER_STATUSES.filter((s) => s !== detail.status).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="Note (optional)" className="flex-1 rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300" />
                <button type="button" onClick={applyStatus} disabled={!newStatus || saving} className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2 text-sm font-semibold disabled:opacity-40">{saving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>

            {(saveMessage || saveError) && <div className={`mt-3 rounded-lg border p-3 text-xs ${saveError ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>{saveError || saveMessage}</div>}

            {/* Verify Payment */}
            {detail && (detail.payment_status === 'UNPAID' || detail.payment_status === 'PENDING') && (
              <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-xs font-semibold text-emerald-300">Verify Payment</p>
                <p className="mt-1 text-[11px] text-slate-500">Confirm that payment was received. This sets payment_status = VERIFIED. It does NOT send the order to the supplier.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setVerifyingPayment(true);
                    setSaveError('');
                    setSaveMessage('');
                    try {
                      const res = await fetch(`/api/admin/orders/${detail.id}/verify-payment`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ note: statusNote || undefined }),
                      });
                      const data = await res.json();
                      if (!res.ok) { setSaveError(data.error || 'Failed to verify payment.'); return; }
                      setDetail((d) => d ? { ...d, status: data.order_status || 'PAYMENT_VERIFIED', payment_status: data.payment_status || 'VERIFIED', fulfillment_status: data.fulfillment_status || 'NOT_STARTED', payment_verification_method: 'MANUAL' } : d);
                      setSaveMessage('Payment verified. You can now start supplier fulfillment.');
                      setStatusNote('');
                    } catch { setSaveError('Could not reach the server.'); }
                    finally { setVerifyingPayment(false); }
                  }}
                  disabled={verifyingPayment}
                  className="mt-2 w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                >
                  {verifyingPayment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Verify Payment'}
                </button>
              </div>
            )}

            {/* Start Fulfillment */}
            {detail && detail.payment_status === 'VERIFIED' && detail.fulfillment_status === 'NOT_STARTED' && (
              <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <p className="text-xs font-semibold text-blue-300">Start Fulfillment</p>
                <p className="mt-1 text-[11px] text-slate-500">Payment is verified. Click to send the order to the supplier. The existing atomic claim prevents duplicate supplier orders.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setStartingFulfillment(true);
                    setSaveError('');
                    setSaveMessage('');
                    try {
                      const res = await fetch(`/api/admin/orders/${detail.id}/start-fulfillment`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                      });
                      const data = await res.json();
                      if (!res.ok) { setSaveError(data.error || 'Failed to start fulfillment.'); return; }
                      if (!data.ok) { setSaveError(data.error || 'Fulfillment failed to start.'); return; }
                      setDetail((d) => d ? { ...d, fulfillment_status: 'PROCESSING', status: 'PROCESSING' } : d);
                      setSaveMessage(data.supplier_reference ? `Fulfillment started. Supplier ref: ${data.supplier_reference}` : 'Fulfillment started. Supplier order created.');
                    } catch { setSaveError('Could not reach the server.'); }
                    finally { setStartingFulfillment(false); }
                  }}
                  disabled={startingFulfillment}
                  className="mt-2 w-full rounded-lg bg-gradient-to-r from-blue-500 to-cyan-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                >
                  {startingFulfillment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Start Fulfillment'}
                </button>
              </div>
            )}

            {/* Retry Fulfillment */}
            {detail && detail.payment_status === 'VERIFIED' && detail.fulfillment_status === 'FAILED' && (
              <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <p className="text-xs font-semibold text-blue-300">Retry Fulfillment</p>
                <p className="mt-1 text-[11px] text-slate-500">Payment is verified but supplier fulfillment failed. Retry will reuse the existing supplier reference — no duplicate order will be created.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setRetryingFulfillment(true);
                    setSaveError('');
                    setSaveMessage('');
                    try {
                      const res = await fetch(`/api/admin/orders/${detail.id}/retry-fulfillment`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                      });
                      const data = await res.json();
                      if (!res.ok) { setSaveError(data.error || 'Failed to retry fulfillment.'); return; }
                      setDetail((d) => d ? { ...d, fulfillment_status: data.fulfillment_status || 'PROCESSING', status: 'PROCESSING' } : d);
                      setSaveMessage(data.message || 'Fulfillment retry triggered.');
                    } catch { setSaveError('Could not reach the server.'); }
                    finally { setRetryingFulfillment(false); }
                  }}
                  disabled={retryingFulfillment}
                  className="mt-2 w-full rounded-lg border border-blue-400/40 bg-blue-400/10 px-4 py-2 text-sm font-semibold text-blue-300 hover:bg-blue-400/20 disabled:opacity-40"
                >
                  {retryingFulfillment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Retry Fulfillment'}
                </button>
              </div>
            )}

            <div className="mt-5 border-t border-[#1b2a45] pt-4">
              <p className="text-xs font-semibold text-slate-300">Order Timeline</p>
              <div className="mt-3 space-y-2 text-xs">
                {detail.timeline.length === 0 && <p className="text-slate-600">No timeline entries yet.</p>}
                {detail.timeline.map((t) => <div key={t.id} className="flex items-start justify-between gap-3"><span className="font-semibold text-slate-200">{t.status}</span><span className="text-[10px] text-slate-500">{new Date(t.created_at).toLocaleString()}</span></div>)}
 </div>
 </div>
          </div>
        </div>}

        {detailError && <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">{detailError}</div>}
      </div>
    </main>
  );
}

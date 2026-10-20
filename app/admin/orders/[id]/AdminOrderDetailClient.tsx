'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';

type TimelineEntry = {
  id: string;
  status: string;
  actor_email: string;
  note: string;
  created_at: string;
};

type PaymentSubmission = {
  id: string;
  payment_method: string;
  reference_number: string;
  amount_cents: number;
  note: string;
  proof_url: string | null;
  submitted_at: string;
};

type Refund = {
  id: string;
  reference: string;
  amount_cents: number;
  reason: string;
  status: string;
  approved_by: string;
  created_at: string;
};

type SupplierTransaction = {
  id: string;
  supplier_id: string;
  supplier_reference: string | null;
  status: string;
  action: string;
  error_message: string | null;
  attempt: number;
  idempotency_key: string | null;
  duration_ms: number | null;
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
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  payment_method: string;
  payment_reference: string | null;
  payment_submitted_at: string | null;
  payment_provider: string | null;
  payment_mode: string;
  payment_verified_at: string | null;
  payment_verified_by: string | null;
  provider_checkout_url: string | null;
  created_at: string;
  updated_at: string;
  player_inputs: Record<string, string>;
  voucher_code: string | null;
  games: { name: string } | null;
  packages: { name: string; amount: string } | null;
};

const ADMIN_STATUSES = [
  'PAYMENT_VERIFIED', 'CANCELLED',
];

const paymentStatusColor: Record<string, string> = {
  UNPAID: 'text-slate-400',
  PENDING: 'text-amber-300',
  VERIFIED: 'text-emerald-400',
  FAILED: 'text-red-400',
  REFUNDED: 'text-slate-400',
};

const fulfillmentStatusColor: Record<string, string> = {
  NOT_STARTED: 'text-slate-500',
  PROCESSING: 'text-blue-300',
  COMPLETED: 'text-emerald-400',
  FAILED: 'text-red-400',
};

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

const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
const fmtTime = (s: string) => new Date(s).toLocaleString();

export default function AdminOrderDetailClient({
  order: initialOrder,
  timeline: initialTimeline,
  paymentSubmission,
  refund,
  supplierTransaction: initialSupplierTx,
  adminEmail,
}: {
  order: OrderDetail;
  timeline: TimelineEntry[];
  paymentSubmission: PaymentSubmission | null;
  refund: Refund | null;
  supplierTransaction: SupplierTransaction | null;
  adminEmail: string;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [timeline, setTimeline] = useState(initialTimeline);
  const [newStatus, setNewStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showRefund, setShowRefund] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundLoading, setRefundLoading] = useState(false);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [retryingFulfillment, setRetryingFulfillment] = useState(false);
  const [startingFulfillment, setStartingFulfillment] = useState(false);
  const [pollingSupplier, setPollingSupplier] = useState(false);
  const [supplierTx, setSupplierTx] = useState<SupplierTransaction | null>(initialSupplierTx);

  // Poll for status updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/status-check`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.status && data.status !== order.status) {
            setOrder((prev) => ({ ...prev, status: data.status, updated_at: data.updated_at }));
            if (data.timeline) setTimeline(data.timeline);
          }
        }
      } catch {
        // Silent fail on poll
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [order.id, order.status]);

  const changeStatus = async () => {
    if (!newStatus) return;
    setUpdating(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, note: statusNote }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to update status.');
        return;
      }
      setOrder((prev) => ({ ...prev, status: data.status }));
      setSuccess(`Status changed to ${data.status}`);
      setNewStatus('');
      setStatusNote('');
      // Refresh timeline
      const tlRes = await fetch(`/api/orders/${order.id}/timeline`, { cache: 'no-store' });
      if (tlRes.ok) {
        const tlData = await tlRes.json();
        if (tlData.timeline) setTimeline(tlData.timeline);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setUpdating(false);
    }
  };

  const requestRefund = async () => {
    if (!refundReason.trim()) return;
    setRefundLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: refundReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to process refund.');
        return;
      }
      setOrder((prev) => ({ ...prev, status: 'REFUND_PENDING' }));
      setSuccess('Refund initiated.');
      setShowRefund(false);
      setRefundReason('');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setRefundLoading(false);
    }
  };

  const canRefund = ['PAID', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'FULFILLMENT_FAILED'].includes(order.status);
  const canVerifyPayment = order.payment_status === 'UNPAID' || order.payment_status === 'PENDING';
  const canStartFulfillment = order.payment_status === 'VERIFIED' && order.fulfillment_status === 'NOT_STARTED';
  const canRetryFulfillment = order.payment_status === 'VERIFIED' && order.fulfillment_status === 'FAILED';

  const verifyPayment = async () => {
    setVerifyingPayment(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: statusNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to verify payment.'); return; }
      setOrder((prev) => ({
        ...prev,
        payment_status: data.payment_status || 'VERIFIED',
        fulfillment_status: data.fulfillment_status || 'NOT_STARTED',
        status: data.order_status || 'PAYMENT_VERIFIED',
        payment_verified_at: new Date().toISOString(),
        payment_verified_by: adminEmail,
        payment_verification_method: 'MANUAL',
      }));
      setSuccess('Payment verified. You can now start supplier fulfillment.');
      setStatusNote('');
      const tlRes = await fetch(`/api/orders/${order.id}/timeline`, { cache: 'no-store' });
      if (tlRes.ok) { const tlData = await tlRes.json(); if (tlData.timeline) setTimeline(tlData.timeline); }
    } catch { setError('Could not reach the server.'); }
    finally { setVerifyingPayment(false); }
  };

  const startFulfillmentNow = async () => {
    setStartingFulfillment(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/start-fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to start fulfillment.'); return; }
      if (!data.ok) { setError(data.error || 'Fulfillment failed to start.'); return; }
      setOrder((prev) => ({ ...prev, fulfillment_status: 'PROCESSING', status: 'PROCESSING' }));
      setSuccess(data.supplier_reference ? `Fulfillment started. Supplier reference: ${data.supplier_reference}` : 'Fulfillment started. Supplier order created.');
      const tlRes = await fetch(`/api/orders/${order.id}/timeline`, { cache: 'no-store' });
      if (tlRes.ok) { const tlData = await tlRes.json(); if (tlData.timeline) setTimeline(tlData.timeline); }
    } catch { setError('Could not reach the server.'); }
    finally { setStartingFulfillment(false); }
  };

  const retryFulfillment = async () => {
    setRetryingFulfillment(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/retry-fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to retry fulfillment.'); return; }
      setOrder((prev) => ({
        ...prev,
        fulfillment_status: data.fulfillment_status || 'PROCESSING',
        status: 'PROCESSING',
      }));
      setSuccess(data.message || 'Fulfillment retry triggered.');
      const tlRes = await fetch(`/api/orders/${order.id}/timeline`, { cache: 'no-store' });
      if (tlRes.ok) { const tlData = await tlRes.json(); if (tlData.timeline) setTimeline(tlData.timeline); }
    } catch { setError('Could not reach the server.'); }
    finally { setRetryingFulfillment(false); }
  };

  const pollSupplierNow = async () => {
    if (!supplierTx?.supplier_reference) return;
    setPollingSupplier(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/poll-supplier-status`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Poll failed.'); return; }
      if (data.fulfillment_status === 'COMPLETED') {
        setOrder((prev) => ({ ...prev, fulfillment_status: 'COMPLETED', status: 'COMPLETED' }));
        setSuccess('Supplier confirmed completion. Order marked as COMPLETED.');
      } else if (data.fulfillment_status === 'FAILED') {
        setOrder((prev) => ({ ...prev, fulfillment_status: 'FAILED', status: 'FULFILLMENT_FAILED' }));
        setSuccess('Supplier reported failure. Order marked as FULFILLMENT_FAILED.');
      } else {
        setSuccess('Supplier still processing. No status change.');
      }
      const tlRes = await fetch(`/api/orders/${order.id}/timeline`, { cache: 'no-store' });
      if (tlRes.ok) { const tlData = await tlRes.json(); if (tlData.timeline) setTimeline(tlData.timeline); }
    } catch { setError('Could not reach the server.'); }
    finally { setPollingSupplier(false); }
  };

  const canPollSupplier = !!supplierTx?.supplier_reference && (supplierTx.status === 'pending' || supplierTx.status === 'submitted');

  const supplierTxLabel = (s: string) =>
    s === 'pending' ? 'Pending' :
    s === 'submitted' ? 'Submitted' :
    s === 'success' ? 'Completed' :
    s === 'failed' ? 'Failed' :
    s === 'timeout' ? 'Timeout' : s;

  const maskKey = (key: string | null) => {
    if (!key) return '—';
    if (key.length <= 12) return key.slice(0, 4) + '***';
    return key.slice(0, 8) + '***' + key.slice(-4);
  };

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/95">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Link href="/admin/orders" className="text-xs text-slate-400 hover:text-cyan-300"><ArrowLeft size={14} className="inline" /> Orders</Link>
            <span className="text-slate-600">/</span>
            <span className="font-mono text-sm text-cyan-300">{order.reference}</span>
          </div>
          <Link href="/admin" className="text-xs text-slate-400">Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1000px] px-5 py-8">
        {error && <div className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-300">{success}</div>}

        <div className="grid gap-5 lg:grid-cols-3">
          {/* Order Info */}
          <div className="lg:col-span-2 space-y-5">
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
              <div className="flex items-center justify-between">
                <h1 className="font-display text-xl font-bold">Order Details</h1>
                <span className={`text-sm font-bold ${statusColor[order.status] || 'text-slate-400'}`}>{order.status}</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div><p className="text-xs text-slate-500">Customer</p><p className="text-sm">{order.customer_name}</p></div>
                <div><p className="text-xs text-slate-500">Email</p><p className="text-sm text-slate-300">{order.email}</p></div>
                <div><p className="text-xs text-slate-500">Game</p><p className="text-sm">{order.games?.name || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Package</p><p className="text-sm">{order.packages?.name || '—'}</p></div>
                <div><p className="text-xs text-slate-500">Payment Method</p><p className="text-sm capitalize">{order.payment_method}</p></div>
                <div><p className="text-xs text-slate-500">Payment Mode</p><p className="text-sm">{order.payment_mode === 'automated' ? <span className="text-blue-300">Automated</span> : <span className="text-slate-300">Manual</span>}</p></div>
                <div><p className="text-xs text-slate-500">Payment Reference</p><p className="text-sm">{order.payment_reference || '—'}</p></div>
                {order.payment_provider && <div><p className="text-xs text-slate-500">Payment Provider</p><p className="text-sm capitalize text-cyan-300">{order.payment_provider}</p></div>}
                {order.payment_verified_at && <div><p className="text-xs text-slate-500">Verified At</p><p className="text-sm">{fmtTime(order.payment_verified_at)}</p></div>}
                {order.payment_verified_by && <div><p className="text-xs text-slate-500">Verified By</p><p className="text-sm text-slate-400">{order.payment_verified_by}</p></div>}
                <div><p className="text-xs text-slate-500">Created</p><p className="text-sm">{fmtTime(order.created_at)}</p></div>
                <div><p className="text-xs text-slate-500">Last Updated</p><p className="text-sm">{fmtTime(order.updated_at)}</p></div>
              </div>
              {Object.keys(order.player_inputs || {}).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-slate-500">Player Information</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {Object.entries(order.player_inputs).map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-[#1b2a45] px-3 py-2 text-xs">
                        <span className="text-slate-500">{k}: </span><span className="text-slate-200">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5 space-y-1 border-t border-[#1b2a45] pt-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{fmtP(order.subtotal_cents)}</span></div>
                {order.discount_cents > 0 && <div className="flex justify-between text-emerald-300"><span>Voucher Discount ({order.voucher_code})</span><span>-{fmtP(order.discount_cents)}</span></div>}
                <div className="flex justify-between font-bold"><span className="text-slate-300">Total</span><span className="text-cyan-300">{fmtP(order.total_cents)}</span></div>
              </div>
            </div>

            {/* Payment Submission */}
            {paymentSubmission && (
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
                <h2 className="font-display text-sm font-semibold">Payment Submission</h2>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-slate-500">Method: </span><span className="capitalize">{paymentSubmission.payment_method}</span></div>
                  <div><span className="text-slate-500">Reference: </span><span className="text-cyan-300">{paymentSubmission.reference_number || '—'}</span></div>
                  <div><span className="text-slate-500">Amount: </span><span>{fmtP(paymentSubmission.amount_cents)}</span></div>
                  <div><span className="text-slate-500">Submitted: </span><span>{fmtTime(paymentSubmission.submitted_at)}</span></div>
                </div>
                {paymentSubmission.note && <div className="mt-3 rounded-lg border border-[#1b2a45] p-3 text-xs text-slate-400">{paymentSubmission.note}</div>}
                {paymentSubmission.proof_url && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs text-slate-500">Payment Proof Screenshot:</p>
                                        <img src={paymentSubmission.proof_url} alt="Payment proof" className="max-h-64 rounded-lg border border-[#253451]" />
                  </div>
                )}
              </div>
            )}

            {/* Refund Info */}
            {refund && (
              <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-6">
                <h2 className="font-display text-sm font-semibold text-orange-300">Refund</h2>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-slate-500">Reference: </span><span className="text-orange-300">{refund.reference}</span></div>
                  <div><span className="text-slate-500">Amount: </span><span>{fmtP(refund.amount_cents)}</span></div>
                  <div><span className="text-slate-500">Status: </span><span className="capitalize">{refund.status}</span></div>
                  <div><span className="text-slate-500">Approved By: </span><span>{refund.approved_by}</span></div>
                </div>
                <div className="mt-3 text-xs text-slate-400">{refund.reason}</div>
              </div>
            )}

            {/* Supplier Fulfillment Section */}
            {supplierTx && (
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-sm font-semibold text-slate-300">Supplier Fulfillment</h2>
                  {canPollSupplier && (
                    <button
                      type="button"
                      onClick={pollSupplierNow}
                      disabled={pollingSupplier}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-1.5 text-xs font-medium text-cyan-300 transition hover:border-cyan-400 disabled:opacity-40"
                    >
                      {pollingSupplier ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      Poll Supplier Now
                    </button>
                  )}
                </div>
                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                  <div><span className="text-slate-500">Supplier: </span><span className="text-slate-200">{supplierTx.suppliers?.name || supplierTx.suppliers?.code || '—'}</span></div>
                  <div><span className="text-slate-500">Transaction ID: </span><span className="font-mono text-slate-400">{supplierTx.id.slice(0, 8)}…</span></div>
                  <div><span className="text-slate-500">Supplier Reference: </span><span className="font-mono text-cyan-300">{supplierTx.supplier_reference || '—'}</span></div>
                  <div><span className="text-slate-500">Supplier Status: </span><span className="text-slate-200">{supplierTxLabel(supplierTx.status)}</span></div>
                  <div><span className="text-slate-500">Attempt: </span><span className="text-slate-200">{supplierTx.attempt}</span></div>
                  <div><span className="text-slate-500">Idempotency Key: </span><span className="font-mono text-slate-400">{maskKey(supplierTx.idempotency_key)}</span></div>
                  <div><span className="text-slate-500">Submitted: </span><span className="text-slate-300">{new Date(supplierTx.created_at).toLocaleString()}</span></div>
                  <div><span className="text-slate-500">Last Polled: </span><span className="text-slate-300">{supplierTx.last_polled_at ? new Date(supplierTx.last_polled_at).toLocaleString() : 'Never'}</span></div>
                  {supplierTx.duration_ms != null && <div><span className="text-slate-500">Duration: </span><span className="text-slate-200">{supplierTx.duration_ms}ms</span></div>}
                </div>
                {supplierTx.error_message && (
                  <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 p-3 text-[11px] text-rose-300">{supplierTx.error_message}</div>
                )}
              </div>
            )}

            {/* Timeline */}
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
              <h2 className="font-display text-sm font-semibold">Order Timeline</h2>
              <div className="mt-4 space-y-3">
                {timeline.length === 0 && <p className="text-xs text-slate-600">No timeline entries yet.</p>}
                {timeline.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {entry.status === 'CANCELLED' || entry.status === 'REFUNDED' ? (
                        <XCircle size={14} className="text-rose-400" />
                      ) : entry.status === 'COMPLETED' || entry.status === 'DELIVERED' || entry.status === 'PAID' ? (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      ) : (
                        <Clock size={14} className="text-amber-300" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${statusColor[entry.status] || 'text-slate-400'}`}>{entry.status}</span>
                        <span className="text-[10px] text-slate-600">{fmtTime(entry.created_at)}</span>
                      </div>
                      {entry.note && <p className="mt-0.5 text-[11px] text-slate-500">{entry.note}</p>}
                      <p className="text-[10px] text-slate-600">by {entry.actor_email}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Status Control Sidebar */}
          <div className="space-y-5">
            {/* Status Panels */}
            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
              <h2 className="font-display text-sm font-semibold">Order Status</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-slate-500">Order</p>
                  <p className={`text-sm font-bold ${statusColor[order.status] || 'text-slate-400'}`}>{order.status}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Payment</p>
                  <p className={`text-sm font-bold ${paymentStatusColor[order.payment_status] || 'text-slate-400'}`}>{order.payment_status}</p>
                  {order.payment_verification_method && (
                    <p className="text-[10px] text-slate-500">
                      {order.payment_verification_method === 'MANUAL' ? 'Manual — Super Admin' : `Automatic — ${order.payment_provider || 'Provider'}`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500">Fulfillment</p>
                  <p className={`text-sm font-bold ${fulfillmentStatusColor[order.fulfillment_status] || 'text-slate-400'}`}>{order.fulfillment_status}</p>
                </div>
              </div>
            </div>

            {/* Verify Payment */}
            {canVerifyPayment && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <h2 className="font-display text-sm font-semibold text-emerald-300">Verify Payment</h2>
                <p className="mt-2 text-xs text-slate-500">Confirm that payment was received. This sets payment_status = VERIFIED. It does NOT send the order to the supplier or mark it as completed.</p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs text-slate-400">Note (optional)</span>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
                    placeholder="Payment reference or note..."
                  />
                </label>
                <button
                  onClick={verifyPayment}
                  disabled={verifyingPayment}
                  className="mt-3 w-full rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {verifyingPayment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Verify Payment'}
                </button>
              </div>
            )}

            {/* Start Fulfillment */}
            {canStartFulfillment && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
                <h2 className="font-display text-sm font-semibold text-blue-300">Start Fulfillment</h2>
                <p className="mt-2 text-xs text-slate-500">Payment is verified. Click to send the order to the supplier. The existing atomic claim prevents duplicate supplier orders.</p>
                <button
                  onClick={startFulfillmentNow}
                  disabled={startingFulfillment}
                  className="mt-3 w-full rounded-lg bg-gradient-to-r from-blue-500 to-cyan-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {startingFulfillment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Start Fulfillment'}
                </button>
              </div>
            )}

            {/* Retry Fulfillment */}
            {canRetryFulfillment && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
                <h2 className="font-display text-sm font-semibold text-blue-300">Retry Fulfillment</h2>
                <p className="mt-2 text-xs text-slate-500">Payment is verified but supplier fulfillment failed. Retry will reuse the existing supplier reference — no duplicate order will be created.</p>
                <button
                  onClick={retryFulfillment}
                  disabled={retryingFulfillment}
                  className="mt-3 w-full rounded-lg border border-blue-400/40 bg-blue-400/10 px-4 py-2.5 text-sm font-semibold text-blue-300 hover:bg-blue-400/20 disabled:opacity-40"
                >
                  {retryingFulfillment ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Retry Fulfillment'}
                </button>
              </div>
            )}

            <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
              <h2 className="font-display text-sm font-semibold">Status Control</h2>
              <div className="mt-4">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-400">Change Status</span>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
                  >
                    <option value="">Select status...</option>
                    {ADMIN_STATUSES.map((s) => (
                      <option key={s} value={s} disabled={s === order.status}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs text-slate-400">Note (optional)</span>
                  <textarea
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
                    placeholder="Add a note..."
                  />
                </label>
                <button
                  onClick={changeStatus}
                  disabled={!newStatus || updating}
                  className="mt-3 w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {updating ? <RefreshCw size={14} className="mx-auto animate-spin" /> : 'Update Status'}
                </button>
              </div>
            </div>

            {/* Refund Action */}
            {canRefund && (
              <div className="rounded-xl border border-orange-400/20 bg-orange-400/5 p-5">
                <h2 className="font-display text-sm font-semibold text-orange-300">Refund</h2>
                {!showRefund ? (
                  <button
                    onClick={() => setShowRefund(true)}
                    className="mt-3 w-full rounded-lg border border-orange-400/40 bg-orange-400/10 px-4 py-2.5 text-sm font-semibold text-orange-300 hover:bg-orange-400/20"
                  >
                    Request Refund
                  </button>
                ) : (
                  <div>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-400">Reason</span>
                      <textarea
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2 text-sm text-slate-300"
                        placeholder="Why is this order being refunded?"
                      />
                    </label>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={requestRefund}
                        disabled={!refundReason.trim() || refundLoading}
                        className="flex-1 rounded-lg bg-orange-500/80 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                      >
                        {refundLoading ? 'Processing...' : 'Confirm Refund'}
                      </button>
                      <button
                        onClick={() => { setShowRefund(false); setRefundReason(''); }}
                        className="rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {refund && refund.status === 'REFUND_PENDING' && order.status === 'REFUND_PENDING' && (
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5">
                <h2 className="font-display text-sm font-semibold">Complete Refund</h2>
                <p className="mt-2 text-xs text-slate-500">Mark this refund as completed once the money has been returned.</p>
                <button
                  onClick={async () => {
                    setUpdating(true);
                    setError('');
                    try {
                      const res = await fetch(`/api/admin/orders/${order.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'REFUNDED', note: 'Refund completed' }),
                      });
                      const data = await res.json();
                      if (!res.ok) { setError(data.error || 'Failed to complete refund.'); return; }
                      setOrder((prev) => ({ ...prev, status: 'REFUNDED' }));
                      setSuccess('Refund completed.');
                    } catch {
                      setError('Could not reach the server.');
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  disabled={updating}
                  className="mt-3 w-full rounded-lg border border-slate-400/40 bg-slate-400/10 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-400/20"
                >
                  Mark as Refunded
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

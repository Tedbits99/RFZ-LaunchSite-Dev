'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, CheckCircle2, Clock, XCircle, Circle, RefreshCw } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import SiteFooter from '@/components/SiteFooter';

type Order = {
  id: string;
  reference: string;
  email: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  total_cents: number;
  created_at: string;
  updated_at: string;
  player_inputs: Record<string, string>;
  payment_method: string;
  games?: { name: string } | null;
  packages?: { name: string; amount: string } | null;
};

type TimelineEntry = {
  id: string;
  status: string;
  note: string;
  created_at: string;
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

const FLOW_STEPS = ['PENDING', 'WAITING_PAYMENT', 'PAYMENT_VERIFIED', 'PROCESSING', 'COMPLETED'];

const statusLabel: Record<string, string> = {
  PENDING: 'Order Received',
  WAITING_PAYMENT: 'Waiting for Payment',
  PAID: 'Payment Confirmed',
  PAYMENT_VERIFIED: 'Payment Verified',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  FULFILLMENT_FAILED: 'Fulfillment Failed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund Requested',
  REFUNDED: 'Refunded',
};

const paymentStatusLabel: Record<string, string> = {
  UNPAID: 'Unpaid',
  PENDING: 'Pending',
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

const fulfillmentStatusLabel: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

const LOG_PREFIX = '[OrderStatus]';

export default function AccountOrderDetailClient({
  order: initialOrder,
  timeline: initialTimeline,
}: {
  order: Order;
  timeline: TimelineEntry[];
}) {
  const [order, setOrder] = useState(initialOrder);
  const [timeline, setTimeline] = useState(initialTimeline);
  const [refreshing, setRefreshing] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<string>('connecting');
  const orderIdRef = useRef(order.id);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${order.id}/status-check`, { cache: 'no-store' });
      if (!res.ok) {
        console.log(LOG_PREFIX, 'poll: status-check returned', res.status);
        return;
      }
      const data = await res.json();
      console.log(LOG_PREFIX, 'poll response:', { status: data.status, payment: data.payment_status, fulfillment: data.fulfillment_status });
      if (data.status) {
        setOrder((prev) => prev ? {
          ...prev,
          status: data.status,
          payment_status: data.payment_status || prev.payment_status,
          fulfillment_status: data.fulfillment_status || prev.fulfillment_status,
          updated_at: data.updated_at || prev.updated_at,
        } : prev);
      }
      if (data.timeline) setTimeline(data.timeline);
      setLastPolledAt(new Date().toISOString());
    } catch (err) {
      console.log(LOG_PREFIX, 'poll error:', err instanceof Error ? err.message : 'unknown');
    }
  }, [order.id]);

  const manualRefresh = useCallback(async () => {
    console.log(LOG_PREFIX, 'manualRefresh clicked');
    setRefreshing(true);
    try {
      await poll();
    } finally {
      setRefreshing(false);
    }
  }, [poll]);

  const isTerminal =
    order.status === 'COMPLETED' ||
    order.status === 'DELIVERED' ||
    order.status === 'FULFILLMENT_FAILED' ||
    order.status === 'FAILED' ||
    order.status === 'EXPIRED' ||
    order.status === 'CANCELLED' ||
    order.status === 'REFUNDED';

  // Polling fallback: every 5 seconds while order is still active.
  useEffect(() => {
    if (isTerminal) {
      console.log(LOG_PREFIX, 'polling stopped — order is terminal:', order.status);
      return;
    }
    console.log(LOG_PREFIX, 'polling started for order', order.id);
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [poll, isTerminal, order.id, order.status]);

  // Supabase Realtime: receive order status changes instantly.
  useEffect(() => {
    const browserClient = getSupabaseBrowserClient();
    if (!browserClient) {
      console.log(LOG_PREFIX, 'Realtime: browser client unavailable — falling back to polling only');
      setRealtimeStatus('unavailable');
      return;
    }
    console.log(LOG_PREFIX, 'Realtime: subscribing to order', order.id);

    const channel = browserClient
      .channel(`order-${order.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` },
        (payload: { new: Record<string, unknown> }) => {
          const n = payload.new as Record<string, any>;
          console.log(LOG_PREFIX, 'Realtime UPDATE event:', { status: n.status, fulfillment: n.fulfillment_status, payment: n.payment_status });
          setOrder((prev) =>
            prev
              ? {
                  ...prev,
                  status: n.status ?? prev.status,
                  payment_status: n.payment_status ?? prev.payment_status,
                  fulfillment_status: n.fulfillment_status ?? prev.fulfillment_status,
                  updated_at: n.updated_at ?? prev.updated_at,
                }
              : prev
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_timeline', filter: `order_id=eq.${order.id}` },
        () => {
          console.log(LOG_PREFIX, 'Realtime TIMELINE INSERT event — triggering poll');
          poll();
        }
      )
      .subscribe((status: string) => {
        console.log(LOG_PREFIX, 'Realtime subscription status:', status);
        setRealtimeStatus(status);
      });

    return () => {
      console.log(LOG_PREFIX, 'Realtime: cleaning up subscription for order', order.id);
      browserClient.removeChannel(channel);
    };
  }, [order.id, poll]);

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  const fmtTime = (s: string) => new Date(s).toLocaleString();
  const paymentVerified = order.payment_status === 'VERIFIED';
  const displayStatus = paymentVerified && (order.status === 'PAID' || order.status === 'PAYMENT_VERIFIED') ? 'PROCESSING' : order.status;
  const currentStepIdx = FLOW_STEPS.indexOf(displayStatus);
  const isFailed = order.status === 'FAILED' || order.status === 'EXPIRED' || order.status === 'FULFILLMENT_FAILED';
  const isCancelled = order.status === 'CANCELLED';
  const isRefundFlow = order.status === 'REFUND_PENDING' || order.status === 'REFUNDED';

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto max-w-[1180px] px-5 py-4"><a href="/account/orders" className="text-xs text-cyan-300">← Orders</a></div></header>
      <div className="mx-auto max-w-3xl px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500"><Link href="/account">Account</Link><ChevronRight size={12} /><Link href="/account/orders">Orders</Link><ChevronRight size={12} /><span className="text-slate-300">{order.reference}</span></nav>

        <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
          <div className="flex items-center justify-between">
            <div><p className="font-mono text-sm text-cyan-300">{order.reference}</p><p className="text-xs text-slate-500">{fmtTime(order.created_at)}</p></div>
            <span className={`text-sm font-semibold ${statusColor[displayStatus] || 'text-slate-300'}`}>{statusLabel[displayStatus] || displayStatus}</span>
          </div>
          <div className="mt-4 rounded-lg border border-[#1b2a45] bg-[#080f20] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><p className="text-[10px] text-slate-500">Payment Status</p><p className="text-xs font-medium text-slate-300">{paymentStatusLabel[order.payment_status] || order.payment_status}</p></div>
              <div><p className="text-[10px] text-slate-500">Fulfillment Status</p><p className="text-xs font-medium text-slate-300">{fulfillmentStatusLabel[order.fulfillment_status] || order.fulfillment_status}</p></div>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-slate-500">Game</p><p className="text-sm">{order.games?.name || '—'}</p></div>
            <div><p className="text-xs text-slate-500">Package</p><p className="text-sm">{order.packages?.name || '—'}</p></div>
            <div><p className="text-xs text-slate-500">Payment Method</p><p className="text-sm capitalize">{order.payment_method}</p></div>
            <div><p className="text-xs text-slate-500">Last Updated</p><p className="text-sm">{fmtTime(order.updated_at)}</p></div>
          </div>
          {Object.keys(order.player_inputs || {}).length > 0 && <div className="mt-4"><p className="text-xs text-slate-500">Player Information</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(order.player_inputs).map(([k, v]) => <div key={k} className="rounded-lg border border-[#1b2a45] px-3 py-2 text-xs"><span className="text-slate-500">{k}: </span><span className="text-slate-200">{v}</span></div>)}</div></div>}
          <div className="mt-5 flex justify-between border-t border-[#1b2a45] pt-4"><span className="text-sm text-slate-400">Total</span><span className="font-display text-lg font-bold text-cyan-300">{fmtP(order.total_cents)}</span></div>
        </div>

        {!isCancelled && !isRefundFlow && !isFailed && (
          <div className="mt-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={manualRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-400/20 hover:border-cyan-400/50 disabled:cursor-wait disabled:opacity-50"
                aria-label="Refresh order status"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh Status'}
              </button>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                {realtimeStatus === 'SUBSCRIBED' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />Live</span>}
                {realtimeStatus === 'connecting' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />Connecting…</span>}
                {realtimeStatus === 'CHANNEL_ERROR' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />Reconnecting…</span>}
                {realtimeStatus === 'TIMED_OUT' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />Reconnecting…</span>}
                {realtimeStatus === 'CLOSED' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />Offline</span>}
                {realtimeStatus === 'unavailable' && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-500" />Polling only</span>}
                {lastPolledAt && <span>· Last sync {fmtTime(lastPolledAt)}</span>}
              </div>
            </div>
            <div className="space-y-1">
              {FLOW_STEPS.map((step, idx) => {
                const isDone = currentStepIdx > idx;
                const isCurrent = currentStepIdx === idx;
                const Icon = isDone ? CheckCircle2 : isCurrent ? Clock : Circle;
                const color = isDone ? 'text-emerald-400' : isCurrent ? 'text-amber-300' : 'text-slate-600';
                return (
                  <div key={step} className="flex items-center gap-3">
                    <Icon size={16} className={color} />
                    <span className={`text-sm ${isDone ? 'text-slate-300' : isCurrent ? 'text-amber-300' : 'text-slate-600'}`}>
                      {statusLabel[step] || step}
                    </span>
                    {isDone && <span className="text-[10px] text-emerald-400">✓</span>}
                    {isCurrent && <span className="text-[10px] text-amber-300">●</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isFailed && (
          <div className="mt-5 rounded-xl border border-red-400/20 bg-red-400/5 p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Order Created</span></div>
              <div className="flex items-center gap-3"><XCircle className={order.status === 'EXPIRED' ? 'text-zinc-400' : 'text-red-400'} size={16} /><span className={`text-sm ${order.status === 'EXPIRED' ? 'text-zinc-300' : 'text-red-300'}`}>{statusLabel[order.status] || order.status}</span></div>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Order Created</span></div>
              <div className="flex items-center gap-3"><XCircle className="text-rose-400" size={16} /><span className="text-sm text-rose-300">Order Cancelled</span></div>
            </div>
          </div>
        )}

        {isRefundFlow && (
          <div className="mt-5 rounded-xl border border-orange-400/20 bg-orange-400/5 p-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Order Created</span></div>
              <div className="flex items-center gap-3"><CheckCircle2 className="text-emerald-400" size={16} /><span className="text-sm text-slate-300">Payment Confirmed</span></div>
              <div className="flex items-center gap-3"><CheckCircle2 className="text-orange-400" size={16} /><span className="text-sm text-orange-300">Refund Requested</span></div>
              {order.status === 'REFUNDED' && <div className="flex items-center gap-3"><CheckCircle2 className="text-slate-400" size={16} /><span className="text-sm text-slate-400">Refunded</span></div>}
            </div>
          </div>
        )}

        {timeline.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
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
      <SiteFooter />
    </main>
  );
}

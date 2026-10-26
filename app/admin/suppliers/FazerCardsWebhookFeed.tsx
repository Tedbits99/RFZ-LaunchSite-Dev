'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, RefreshCcw, Radio, ShieldCheck } from 'lucide-react';
import { createAdminBrowserClient } from '@/lib/authSessionBrowserClients';
import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { categorizeFazerCardsEvent, titleForFazerCardsEvent, summarizeFazerCardsStatus } from '@/lib/suppliers/fazercardsEvents';

type SupplierEvent = {
  id: string;
  event_id: string;
  event_type: string;
  supplier_reference: string | null;
  supplier_status: string | null;
  previous_status: string | null;
  received_at: string;
  linked_order_id: string | null;
  processing_status: string;
};

export default function FazerCardsWebhookFeed({ compact = false }: { compact?: boolean }) {
  const [events, setEvents] = useState<SupplierEvent[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'created' | 'status'>('all');
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/fazercards-webhooks', {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? 'Admin session unavailable' : 'Supplier events unavailable');
      const json = await response.json() as { events?: SupplierEvent[] };
      setEvents(json.events ?? []);
      setError('');
      setSyncedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Supplier events unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10000);
    let closed = false;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;

    const connect = async () => {
      try {
        // PR #14 uses a dedicated admin cookie namespace; older deployments
        // use the original shared namespace. Support both during transition.
        const adminClient = createAdminBrowserClient();
        const adminSession = await adminClient.auth.getSession();
        client = adminSession.data.session ? adminClient : getSupabaseBrowserClient();
        if (!client || closed) return;
        const currentSession = await client.auth.getSession();
        if (!currentSession.data.session || closed) return;
        channel = client.channel('admin-fazercards-webhooks')
          .on('postgres_changes', {
            event: '*', schema: 'public', table: 'fazercards_webhook_events',
          }, () => { void refresh(); })
          .subscribe(status => { if (!closed) setLive(status === 'SUBSCRIBED'); });
      } catch {
        if (!closed) setLive(false);
      }
    };
    void connect();

    return () => {
      closed = true;
      clearInterval(timer);
      if (client && channel) void client.removeChannel(channel);
    };
  }, [refresh]);

  const newOrderCount = events.filter(event => categorizeFazerCardsEvent(event.event_type) === 'created').length;
  const statusChangeCount = events.filter(event => categorizeFazerCardsEvent(event.event_type) === 'status').length;
  const filteredEvents = selectedCategory === 'all'
    ? events
    : events.filter(event => categorizeFazerCardsEvent(event.event_type) === selectedCategory);
  const shownEvents = compact ? filteredEvents.slice(0, 5) : filteredEvents;

  return (
    <section className="rounded-xl border border-[#253451] bg-[#0b1225] p-4 sm:p-5" aria-label="FazerCards supplier activity">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity size={16} className="text-cyan-300" /> FazerCards supplier events
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Signed order updates and supplier messages · no payment is verified by webhook alone
          </p>
        </div>
        <button type="button" onClick={() => { void refresh(); }}
          aria-label="Refresh supplier events"
          className="rounded-lg border border-[#253451] p-2 text-slate-300 hover:text-cyan-300">
          <RefreshCcw size={15}/>
        </button>
      </header>
      <p className="mb-3 flex items-center gap-2 text-[11px] text-slate-400">
        {live ? <Radio size={13} className="text-emerald-400" /> : <RefreshCcw size={13} />}
        {live ? 'Realtime connected' : 'Checking every 10 seconds'}
        {syncedAt && <span>· Last sync {new Date(syncedAt).toLocaleTimeString()}</span>}
      </p>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter FazerCards supplier event type">
        {([
          { value: 'all', label: 'All activity', count: events.length },
          { value: 'created', label: 'New orders', count: newOrderCount },
          { value: 'status', label: 'Order status changes', count: statusChangeCount },
        ] as const).map(filter => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={selectedCategory === filter.value}
            onClick={() => setSelectedCategory(filter.value)}
            className={`rounded-lg border px-3 py-2 text-xs transition ${
              selectedCategory === filter.value
                ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200'
                : 'border-[#253451] text-slate-400 hover:border-cyan-400/40 hover:text-slate-200'
            }`}
          >
            {filter.label} <span className="font-semibold tabular-nums">({filter.count})</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        Counts reflect the latest 30 supplier events, including orders created in FazerCards outside RunFazone.
      </p>
      {error && <p role="status" className="mb-3 rounded-lg bg-amber-900/20 px-3 py-2 text-xs text-amber-300">{error}</p>}
      {events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#253451] p-4 text-xs text-slate-400">
          No signed FazerCards events received yet. Configure the webhook secret and use Send test in the reseller panel.
        </p>
      ) : shownEvents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#253451] p-4 text-xs text-slate-400">No matching supplier events in the latest activity.</p>
      ) : (
        <div className="space-y-2" aria-live="polite">
          {shownEvents.map((event) => (
            <div key={event.id} className="rounded-lg border border-[#253451] bg-[#070e1e] px-3 py-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-200">{titleForFazerCardsEvent(event.event_type)}</p>
                <time className="shrink-0 text-[10px] text-slate-500" dateTime={event.received_at}>
                  {new Date(event.received_at).toLocaleTimeString()}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-400">
                {event.supplier_reference && <span className="font-mono">{event.supplier_reference}</span>}
                {(event.supplier_status || event.previous_status) && <span className="rounded bg-cyan-400/10 px-2 py-0.5 text-cyan-200">{summarizeFazerCardsStatus(event.previous_status, event.supplier_status)}</span>}
                {event.linked_order_id
                  ? <Link className="text-cyan-300 hover:underline" href={`/admin/orders/${event.linked_order_id}`}>RunFazone order</Link>
                  : <span>Supplier account activity</span>}
                {event.processing_status === 'reconciled' &&
                  <span className="flex items-center gap-1 text-emerald-300"><ShieldCheck size={12}/> Verified</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {compact && <Link href="/admin/notifications" className="mt-3 block text-right text-xs text-cyan-300 hover:underline">View all supplier events</Link>}
    </section>
  );
}

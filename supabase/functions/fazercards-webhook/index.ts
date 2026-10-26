import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * FazerCards public signed webhook receiver.
 * Reference: https://reseller.fazercards.com/en/docs/webhooks
 * No supplier order creation, payment verification, or direct order-status
 * mutation occurs from an unverified webhook payload.
 */
const MAX_BYTES = 64 * 1024;
const FAZERCARDS_API = 'https://api.fzr.cards/api/v2';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function bounded(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

async function validSignature(
  bytes: Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const expected = 'sha256=' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  // Equal-size, fixed-work comparison; do not disclose comparison details.
  let mismatch = 0;
  const received = signature.toLowerCase();
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const secret = Deno.env.get('FAZERCARDS_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) return reply(503, { error: 'Webhook not configured' });

  let bytes: Uint8Array;
  try {
    const input = await request.arrayBuffer();
    if (input.byteLength === 0 || input.byteLength > MAX_BYTES) return reply(413, { error: 'Invalid payload size' });
    bytes = new Uint8Array(input);
  } catch {
    return reply(400, { error: 'Invalid payload' });
  }
  if (!await validSignature(bytes, request.headers.get('x-webhook-signature'), secret)) {
    return reply(401, { error: 'Invalid signature' });
  }

  let message: Record<string, unknown>;
  try {
    message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('shape');
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  const eventId = bounded(message.event_id, 128);
  const eventType = bounded(message.event, 80);
  if (!eventId || eventId.length < 8 || !eventType) return reply(422, { error: 'Invalid event envelope' });

  const data = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? message.data as Record<string, unknown> : {};
  const reference = bounded(data.order_id, 160);
  const status = bounded(data.status, 64);
  const previousStatus = bounded(data.previous_status, 64);
  const timestamp = bounded(message.timestamp, 60);
  const occurredAt = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : null;
  const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: linked, error: linkError } = reference
    ? await db.from('supplier_transactions').select('id,order_id,status')
      .eq('supplier_reference', reference).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (linkError) return reply(503, { error: 'Lookup unavailable' });

  const { data: entry, error: insertError } = await db.from('fazercards_webhook_events').insert({
    event_id: eventId,
    event_type: eventType,
    supplier_reference: reference,
    supplier_status: status,
    previous_status: previousStatus,
    occurred_at: occurredAt,
    linked_order_id: linked?.order_id ?? null,
    processing_status: linked ? 'observed' : 'not_linked',
  }).select('id').single();
  if (insertError?.code === '23505') return reply(200, { received: true, duplicate: true });
  if (insertError || !entry) {
    console.error('FazerCards webhook persistence failed', insertError?.code ?? 'unknown');
    return reply(503, { error: 'Persistence unavailable' });
  }

  // Webhooks are a realtime signal. The existing canonical reconciliation RPC
  // alone changes fulfillment state, after an independent supplier API GET.
  // No payment status is ever changed by this receiver.
  if (linked?.id && reference && eventType === 'order.status_changed'
      && (status === 'completed' || status === 'failed')) {
    const task = (async () => {
      const apiKey = Deno.env.get('SUPPLIER_FAZERCARDS_API_KEY');
      if (!apiKey) return;
      const response = await fetch(FAZERCARDS_API + '/orders/' + encodeURIComponent(reference), {
        method: 'GET', headers: { 'X-API-Key': apiKey },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error('supplier_read_failed');
      const json = await response.json();
      const supplierOrder = json?.order ?? json;
      if (!supplierOrder || supplierOrder.id !== reference) return;
      const upstreamStatus = String(supplierOrder.status ?? '').toLowerCase();
      const outcome = upstreamStatus === 'completed' ? 'completed'
        : upstreamStatus === 'failed' && typeof supplierOrder.fail_reason === 'string'
          && supplierOrder.fail_reason.trim() ? 'failed' : null;
      if (!outcome) return;
      const { data: result, error } = await db.rpc('finalize_supplier_reconciliation', {
        p_supplier_transaction_id: linked.id,
        p_outcome: outcome,
        p_actor: 'fazercards-webhook',
        p_fail_reason: outcome === 'failed' ? supplierOrder.fail_reason : null,
      });
      const row = Array.isArray(result) ? result[0] : result;
      if (error || !['applied', 'already-finalized'].includes(String(row?.out_outcome))) throw new Error('reconciliation_failed');
      await db.from('fazercards_webhook_events').update({ processing_status: 'reconciled' }).eq('id', entry.id);
    })().catch(async () => {
      await db.from('fazercards_webhook_events').update({
        processing_status: 'error', last_error_code: 'pending_canonical_reconciliation',
      }).eq('id', entry.id);
    });
    EdgeRuntime.waitUntil(task);
  }
  return reply(200, { received: true });
});

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { hasValidReconciliationSecret } from '@/lib/reconciliationSecurity';

/*
  Node.js-compatible fulfillment handoff batch worker, ported from
  supabase/functions/_shared/fulfillmentHandoffWorker.ts (same pipeline:
  verified-payment gate -> atomic complete_fulfillment claim -> captured
  supplier mapping -> idempotent supplier transaction -> FazerCards call ->
  recorded outcome -> lease-bound ack). FazerCards is the only supplier.

  Executes inside the Next.js server (app/api/internal/fulfillment-handoff),
  bypassing the broken Edge Function gateway. All secrets are read from
  server-side environment/_cron_secrets; nothing here may run in a browser.
*/

const FAZERCARDS_BASE = 'https://api.fzr.cards/api/v2';
const FAZERCARDS_TIMEOUT_MS = 30000;
export const CLAIM_BATCH_LIMIT = 1;
export const LEASE_SECONDS = 300;

export type HandoffRow = {
  out_id: string;
  out_order_id: string;
  out_attempt_count: number;
  out_lease_token: string;
  out_lease_until: string;
};

export type BatchResult = {
  claimed: number;
  fulfilled: number;
  failed: number;
  rejected: number;
};

export function isAuthorizedFulfillmentHandoffRequest(
  providedSecret: string | null,
  configuredSecret: string | null | undefined,
): boolean {
  return hasValidReconciliationSecret(providedSecret, configuredSecret);
}

export async function getFulfillmentHandoffSecret(
  db: SupabaseClient,
): Promise<string | null> {
  const { data: secretRow, error } = await db
    .from('_cron_secrets')
    .select('value')
    .eq('key', 'fulfillment_handoff_secret')
    .maybeSingle();
  if (error) return null;
  return typeof secretRow?.value === 'string' && secretRow.value.length > 0 ? secretRow.value : null;
}

export async function fazercardsCreateOrder(
  apiKey: string,
  categoryId: string,
  offerId: string,
  fields: Record<string, string>,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; supplierReference: string | null; error: string | null; rawResponse: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAZERCARDS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${FAZERCARDS_BASE}/topups/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ category_id: categoryId, offer_id: offerId, fields }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `FazerCards error: HTTP ${res.status}`;
      return { success: false, supplierReference: null, error: String(msg), rawResponse: data };
    }
    const order = (data?.order as Record<string, unknown>) || {};
    return {
      success: Boolean(data?.ok ?? true),
      supplierReference: String(order.id ?? data?.order_id ?? '') || null,
      error: null,
      rawResponse: data,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Supplier request failed';
    return { success: false, supplierReference: null, error: msg, rawResponse: null };
  } finally {
    clearTimeout(timer);
  }
}

type OrderRow = {
  id: string;
  payment_status: string;
  fulfillment_status: string;
  package_id: string;
  player_inputs: Record<string, unknown> | null;
  supplier_mapping_id: string | null;
};

// Mirrors the reviewed Deno worker: gate -> claim -> mapping -> idempotent
// transaction -> supplier call -> outcome. No divergence from that contract.
export async function runFulfillmentForOrder(
  supabase: SupabaseClient,
  orderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('id, payment_status, fulfillment_status, package_id, player_inputs, supplier_mapping_id')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return { success: false, error: 'Order not found' };
    const o = order as OrderRow;

    if (o.fulfillment_status === 'COMPLETED') return { success: true, error: null };
    if (o.fulfillment_status === 'PROCESSING') {
      // A concurrent fulfillment (admin start/retry or webhook) owns the order.
      // The handoff row is acked as done: the pipeline took over.
      return { success: true, error: null };
    }
    if (o.payment_status !== 'VERIFIED') {
      return { success: false, error: 'Payment not verified — fulfillment not authorized' };
    }

    const { data: claimResult, error: claimError } = await supabase.rpc('complete_fulfillment', {
      p_order_id: orderId,
      p_fulfillment_status: 'PROCESSING',
      p_actor_email: 'fulfillment_system',
      p_note: 'Supplier fulfillment started',
    });
    if (claimError) return { success: false, error: 'Failed to claim order: ' + claimError.message };
    const claimRow = Array.isArray(claimResult) ? claimResult[0] : claimResult;
    if (!claimRow?.out_transitioned) {
      // Another execution already claimed this order — nothing to do.
      return { success: true, error: null };
    }

    let mapping: Record<string, unknown> | null = null;
    if (o.supplier_mapping_id) {
      const { data: captured } = await supabase
        .from('supplier_package_mappings')
        .select('*, suppliers(*)')
        .eq('id', o.supplier_mapping_id)
        .maybeSingle();
      mapping = (captured as Record<string, unknown>) || null;
    }
    if (!mapping) {
      const { data: mappings } = await supabase
        .from('supplier_package_mappings')
        .select('*, suppliers(*)')
        .eq('package_id', o.package_id)
        .eq('enabled', true)
        .order('priority', { ascending: false });
      const eligible = ((mappings || []) as Record<string, unknown>[]).filter(
        (m) => m.enabled && (m.suppliers as Record<string, unknown>)?.enabled
          && (m.metadata as Record<string, unknown>)?.category_id
          && (m.metadata as Record<string, unknown>)?.offer_id,
      );
      mapping = eligible[0] || null;
    }
    const suppliers = mapping?.suppliers as Record<string, unknown> | undefined;
    const metadata = mapping?.metadata as Record<string, unknown> | undefined;
    if (!mapping || !suppliers?.enabled || !metadata?.category_id || !metadata?.offer_id) {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'FAILED',
        p_actor_email: 'fulfillment_system',
        p_note: 'Fulfillment failed: no active supplier mapping for this package',
      });
      return { success: false, error: 'No active supplier mapping for this package' };
    }

    // Idempotency: an existing active transaction means the pipeline already
    // created the supplier order — never duplicate it. Also re-checked inside
    // the claim RPC, and the supplier call itself carries an Idempotency-Key.
    const { data: existingTx } = await supabase
      .from('supplier_transactions')
      .select('id, status, supplier_reference')
      .eq('order_id', orderId)
      .eq('action', 'create_order')
      .in('status', ['submitted', 'success', 'pending'])
      .maybeSingle();
    if (existingTx) return { success: true, error: null };

    const supplierId = String(suppliers.id);
    const idempotencyKey = `order_${orderId}_supplier_${supplierId}_retry_1`;
    const { data: pendingTx, error: txError } = await supabase
      .from('supplier_transactions')
      .insert({
        order_id: orderId,
        supplier_id: supplierId,
        mapping_id: String(mapping.id),
        idempotency_key: idempotencyKey,
        action: 'create_order',
        status: 'pending',
        request_payload: {
          product_id: mapping.supplier_product_id,
          player_id: (o.player_inputs || {}).user_id || null,
        },
        attempt: 1,
      })
      .select()
      .single();
    if (txError || !pendingTx) {
      // Unique violation = concurrent fulfillment — abort without calling supplier.
      return { success: true, error: null };
    }

    const playerInputs = o.player_inputs || {};
    const fields: Record<string, string> = {};
    if (playerInputs.user_id || playerInputs.player_id) {
      fields.player_id = String(playerInputs.user_id || playerInputs.player_id);
    }
    if (playerInputs.server_id || playerInputs.serverId) {
      fields.server_id = String(playerInputs.server_id || playerInputs.serverId);
    }
    const apiKey = process.env.SUPPLIER_FAZERCARDS_API_KEY || '';
    const result = await fazercardsCreateOrder(
      apiKey,
      String(metadata.category_id),
      String(metadata.offer_id),
      fields,
      idempotencyKey,
      fetchImpl,
    );

    // An aborted/timeout request stays "pending": the supplier may or may not
    // have created the order. Auto-reconciliation resolves it from the
    // supplier's authoritative status; never guess FAILED here.
    const isTimeout = (result.error || '').includes('abort');
    await supabase
      .from('supplier_transactions')
      .update({
        status: isTimeout ? 'pending' : result.success ? 'submitted' : 'failed',
        supplier_reference: result.supplierReference,
        response_payload: result.rawResponse,
        error_message: result.error,
        duration_ms: null,
        attempt: 1,
      })
      .eq('id', (pendingTx as Record<string, unknown>).id as string);

    await supabase
      .from('suppliers')
      .update({
        last_success_at: result.success ? new Date().toISOString() : null,
        last_failure_at: result.success ? null : new Date().toISOString(),
        last_error: result.success ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supplierId);

    if (result.success) {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'PROCESSING',
        p_actor_email: 'fulfillment_system',
        p_note: `Supplier order created: ${result.supplierReference || 'N/A'}`,
      });
      return { success: true, error: null };
    }
    if (!isTimeout) {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'FAILED',
        p_actor_email: 'fulfillment_system',
        p_note: `Fulfillment failed: ${result.error || 'Unknown error'}`,
      });
    }
    return { success: false, error: result.error || 'Supplier order failed' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Fulfillment failed' };
  }
}

export async function processFulfillmentHandoffBatch(
  db: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<BatchResult> {
  const { data: claimed, error: claimError } = await db.rpc('rf_coin_claim_fulfillment_handoffs', {
    p_limit: CLAIM_BATCH_LIMIT,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimError) {
    throw new Error('Claim failed: ' + claimError.message);
  }

  const rows = ((claimed as unknown as HandoffRow[]) || []) as HandoffRow[];
  if (rows.length === 0) {
    return { claimed: 0, fulfilled: 0, failed: 0, rejected: 0 };
  }

  let fulfilled = 0;
  let failed = 0;
  let rejected = 0;

  for (const row of rows) {
    if (!row?.out_id || !row?.out_order_id || !row?.out_lease_token) {
      rejected++;
      continue;
    }
    const result = await runFulfillmentForOrder(db, row.out_order_id, fetchImpl);
    const { data: ack, error: ackError } = await db.rpc('rf_coin_ack_fulfillment_handoff', {
      p_id: row.out_id,
      p_lease_token: row.out_lease_token,
      p_error: result.error,
    });
    const ackRow = Array.isArray(ack) ? ack[0] : ack;
    if (ackError || !ackRow || ackRow.out_status === 'rejected') {
      rejected++;
      continue;
    }
    if (result.success) {
      fulfilled++;
    } else {
      failed++;
    }
  }

  return { claimed: rows.length, fulfilled, failed, rejected };
}

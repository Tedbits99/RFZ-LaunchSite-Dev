import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { hasValidReconciliationSecret } from '@/lib/reconciliationSecurity';
import { isSupplierFulfillmentReleased } from '@/lib/supplierFulfillmentRelease';

/*
  Node.js-compatible fulfillment handoff batch worker, ported from
  supabase/functions/_shared/fulfillmentHandoffWorker.ts. FazerCards is the
  only supplier. Executes inside the Next.js server
  (app/api/internal/fulfillment-handoff). All secrets are server-side only.

  Outcome classification (financial-correctness critical):
  - "confirmed-success": supplier returned an order. Persist reference.
  - "confirmed-failure": supplier responded with an explicit terminal
    failure status + reason. The order is FAILED; retrying with a fresh
    idempotency suffix is a separate operator decision.
  - "ambiguous": transport error, timeout, connection reset, HTTP 5xx, or a
    non-terminal body. The supplier MAY have created the order. FazerCards'
    documented Idempotency-Key contract (original order returned on replay,
    7-day key retention) makes an identical retry with the SAME key safe —
    it cannot double-charge. The transaction stays pending with the attempt
    recorded; the queue row is acked with a retryable error so it stays in
    bounded backoff and dead-letters (operator-visible) if unresolved.

  A pending transaction WITHOUT a supplier reference cannot be resolved by
  auto-reconciliation (it polls by reference). Such rows surface an explicit
  operator-visible error in supplier_transactions and the queue row is kept
  retryable until dead-letter; they are resolved by controlled retry with the
  same idempotency key (safe per the documented contract) or manual supplier
  panel review. Duplicate submission is blocked by the existing-transaction
  check here and the active-transaction precondition in the claim RPC.
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

export type SupplierOutcome =
  | { kind: 'confirmed-success'; supplierReference: string; rawResponse: unknown }
  | { kind: 'confirmed-failure'; error: string; rawResponse: unknown }
  | { kind: 'ambiguous'; error: string; rawResponse: unknown };

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

function mapOrderStatus(raw: string): 'completed' | 'failed' | 'processing' {
  const s = raw.toLowerCase();
  if (s.includes('complet') || s.includes('success') || s.includes('done')) return 'completed';
  if (s.includes('fail') || s.includes('error') || s.includes('cancel')) return 'failed';
  return 'processing';
}

// Mirrors hasExplicitCreateFailure in the reviewed FazerCards adapter: only an
// explicit terminal failure status + reason proves the order was not created.
function hasExplicitCreateFailure(data: Record<string, unknown> | null): boolean {
  const order = data?.order as Record<string, unknown> | undefined;
  const rawStatus = order?.status ?? data?.status;
  const rawError = order?.error ?? order?.fail_reason ?? data?.error ?? data?.message;
  return typeof rawStatus === 'string'
    && mapOrderStatus(rawStatus) === 'failed'
    && typeof rawError === 'string'
    && rawError.trim().length > 0;
}

function extractFailureReason(data: Record<string, unknown> | null): string | null {
  const order = data?.order as Record<string, unknown> | undefined;
  const raw = order?.error ?? order?.fail_reason ?? data?.error ?? data?.message;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function extractSupplierReference(data: Record<string, unknown> | null): string | null {
  const order = (data?.order as Record<string, unknown>) || {};
  return String(order.id ?? data?.order_id ?? '') || null;
}

export async function fazercardsCreateOrder(
  apiKey: string,
  categoryId: string,
  offerId: string,
  fields: Record<string, string>,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupplierOutcome> {
  if (!isSupplierFulfillmentReleased(process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE)) {
    return { kind: 'confirmed-failure', error: 'Supplier fulfillment is disabled', rawResponse: null };
  }
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
    // Only an explicit terminal failed status + reason proves the order was
    // not created — regardless of the HTTP status code.
    if (hasExplicitCreateFailure(data)) {
      return { kind: 'confirmed-failure', error: extractFailureReason(data) || `FazerCards: HTTP ${res.status}`, rawResponse: data };
    }
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        // 4xx: the supplier refused the request before creating anything —
        // no idempotency ambiguity is possible.
        return { kind: 'confirmed-failure', error: extractFailureReason(data) || `FazerCards: HTTP ${res.status}`, rawResponse: data };
      }
      // 5xx, 408, 429: the supplier may have accepted the order. Unknown.
      return { kind: 'ambiguous', error: `FazerCards: HTTP ${res.status}`, rawResponse: data };
    }
    const supplierReference = extractSupplierReference(data);
    if (data?.ok === false) {
      return { kind: 'confirmed-failure', error: extractFailureReason(data) || 'FazerCards rejected the order', rawResponse: data };
    }
    if (!supplierReference) {
      // 2xx without an order reference is not a provable success.
      return { kind: 'ambiguous', error: 'FazerCards: no order reference in response', rawResponse: data };
    }
    return { kind: 'confirmed-success', supplierReference, rawResponse: data };
  } catch (e) {
    // Abort/timeout, connection reset, DNS failure — transport-level, so the
    // request may or may not have arrived. Unknown outcome.
    const msg = e instanceof Error ? e.message : 'Supplier request failed';
    return { kind: 'ambiguous', error: msg, rawResponse: null };
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

export async function runFulfillmentForOrder(
  supabase: SupabaseClient,
  orderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; error: string | null; ambiguous: boolean }> {
  if (!isSupplierFulfillmentReleased(process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE)) {
    return { success: false, error: 'Supplier fulfillment is disabled', ambiguous: false };
  }
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('id, payment_status, fulfillment_status, package_id, player_inputs, supplier_mapping_id')
      .eq('id', orderId)
      .maybeSingle();
    if (!order) return { success: false, error: 'Order not found', ambiguous: false };
    const o = order as OrderRow;

    if (o.fulfillment_status === 'COMPLETED') return { success: true, error: null, ambiguous: false };
    if (o.fulfillment_status === 'PROCESSING') {
      // Either a concurrent fulfillment owns the order, or a previous run
      // crashed between the PROCESSING claim and the supplier call. Do not
      // ack DONE: a stranded order must stay retryable. The ack error puts
      // the row back in bounded backoff; if the concurrent owner completes
      // the order, the claim preconditions simply stop serving the row.
      return { success: false, error: 'Order fulfillment already in progress (PROCESSING); will retry', ambiguous: false };
    }
    if (o.payment_status !== 'VERIFIED') {
      return { success: false, error: 'Payment not verified — fulfillment not authorized', ambiguous: false };
    }

    const { data: claimResult, error: claimError } = await supabase.rpc('complete_fulfillment', {
      p_order_id: orderId,
      p_fulfillment_status: 'PROCESSING',
      p_actor_email: 'fulfillment_system',
      p_note: 'Supplier fulfillment started',
    });
    if (claimError) return { success: false, error: 'Failed to claim order: ' + claimError.message, ambiguous: false };
    const claimRow = Array.isArray(claimResult) ? claimResult[0] : claimResult;
    if (!claimRow?.out_transitioned) {
      // Another execution already claimed this order — nothing to do.
      return { success: true, error: null, ambiguous: false };
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
      return { success: false, error: 'No active supplier mapping for this package', ambiguous: false };
    }

    // FazerCards-only enforcement: this worker speaks only the FazerCards
    // adapter protocol. A non-FazerCards mapping must never receive a
    // request; historical records are preserved untouched.
    if (suppliers.code !== 'fazercards' || suppliers.adapter !== 'custom') {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'FAILED',
        p_actor_email: 'fulfillment_system',
        p_note: 'Fulfillment blocked: selected supplier is not the configured FazerCards supplier',
      });
      return { success: false, error: 'Unsupported supplier — FazerCards only', ambiguous: false };
    }

    // Idempotency: an existing active transaction means the pipeline already
    // created (or may have created) the supplier order — never duplicate it.
    const { data: existingTx } = await supabase
      .from('supplier_transactions')
      .select('id, status, supplier_reference')
      .eq('order_id', orderId)
      .eq('action', 'create_order')
      .in('status', ['submitted', 'success', 'pending'])
      .maybeSingle();
    if (existingTx) {
      // A pending transaction with no supplier reference is an unresolved
      // ambiguous attempt: auto-reconciliation cannot see it (it polls by
      // reference) and a new order must never be created on top of it.
      // Surface it operator-visibly and keep the queue row retryable so it
      // dead-letters into manual review if unresolved.
      if (existingTx.status === 'pending' && !existingTx.supplier_reference) {
        const msg = 'Ambiguous attempt: no supplier reference; needs controlled retry (same idempotency key) or manual review';
        await supabase
          .from('supplier_transactions')
          .update({ error_message: msg })
          .eq('id', (existingTx as Record<string, unknown>).id as string);
        return { success: false, error: msg, ambiguous: true };
      }
      // submitted/success/pending-with-reference: auto-reconciliation owns
      // the outcome via the captured reference — ack as done.
      return { success: true, error: null, ambiguous: false };
    }

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
      return { success: true, error: null, ambiguous: false };
    }
    const pendingTxId = (pendingTx as Record<string, unknown>).id as string;

    // Fail closed before the irreversible step: without API credentials the
    // request must not leave a pending "maybe created" transaction behind.
    const apiKey = process.env.SUPPLIER_FAZERCARDS_API_KEY || '';
    if (!apiKey) {
      await supabase
        .from('supplier_transactions')
        .update({
          status: 'failed',
          error_message: 'Missing FazerCards API key — no supplier request was sent',
        })
        .eq('id', pendingTxId);
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'FAILED',
        p_actor_email: 'fulfillment_system',
        p_note: 'Fulfillment failed: supplier credentials not configured',
      });
      return { success: false, error: 'Supplier credentials not configured', ambiguous: false };
    }

    const outcome = await fazercardsCreateOrder(
      apiKey,
      String(metadata.category_id),
      String(metadata.offer_id),
      (() => {
        const playerInputs = o.player_inputs || {};
        const fields: Record<string, string> = {};
        if (playerInputs.user_id || playerInputs.player_id) {
          fields.player_id = String(playerInputs.user_id || playerInputs.player_id);
        }
        if (playerInputs.server_id || playerInputs.serverId) {
          fields.server_id = String(playerInputs.server_id || playerInputs.serverId);
        }
        return fields;
      })(),
      idempotencyKey,
      fetchImpl,
    );

    const supplierUpdate: Record<string, unknown> = {
      response_payload: outcome.rawResponse,
      error_message: outcome.kind === 'confirmed-success' ? null : outcome.error,
      duration_ms: null,
      attempt: 1,
    };
    if (outcome.kind === 'confirmed-success') {
      supplierUpdate.status = 'submitted';
      supplierUpdate.supplier_reference = outcome.supplierReference;
    } else if (outcome.kind === 'confirmed-failure') {
      supplierUpdate.status = 'failed';
    } else {
      // Ambiguous: stays pending. Auto-reconciliation resolves it once a
      // reference exists; without one it is surfaced for controlled retry.
      supplierUpdate.status = 'pending';
    }
    await supabase
      .from('supplier_transactions')
      .update(supplierUpdate)
      .eq('id', pendingTxId);

    await supabase
      .from('suppliers')
      .update({
        last_success_at: outcome.kind === 'confirmed-success' ? new Date().toISOString() : null,
        last_failure_at: outcome.kind === 'confirmed-success' ? null : new Date().toISOString(),
        last_error: outcome.kind === 'confirmed-success' ? null : outcome.error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', supplierId);

    if (outcome.kind === 'confirmed-success') {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'PROCESSING',
        p_actor_email: 'fulfillment_system',
        p_note: `Supplier order created: ${outcome.supplierReference}`,
      });
      return { success: true, error: null, ambiguous: false };
    }

    if (outcome.kind === 'confirmed-failure') {
      await supabase.rpc('complete_fulfillment', {
        p_order_id: orderId,
        p_fulfillment_status: 'FAILED',
        p_actor_email: 'fulfillment_system',
        p_note: `Fulfillment failed: ${outcome.error}`,
      });
      return { success: false, error: outcome.error, ambiguous: false };
    }

    // Ambiguous: order stays PROCESSING (never FAILED, never re-claimed by
    // this queue), tx stays pending. The lease-bound ack below records the
    // error; with attempts exhausted the row dead-letters for manual review.
    return { success: false, error: outcome.error, ambiguous: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Fulfillment failed', ambiguous: true };
  }
}

export async function processFulfillmentHandoffBatch(
  db: SupabaseClient,
  fetchImpl: typeof fetch = fetch,
): Promise<BatchResult> {
  if (!isSupplierFulfillmentReleased(process.env.RUNFAZONE_SUPPLIER_FULFILLMENT_RELEASE)) {
    return { claimed: 0, fulfilled: 0, failed: 0, rejected: 0 };
  }
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

import { createClient } from '@supabase/supabase-js';
import { getAdapter, type SupplierConfig, type FulfillmentResult } from './adapter';

type SupplierRow = {
  id: string; code: string; adapter: string; api_url: string; sandbox_api_url: string | null;
  environment: string; enabled: boolean; priority: number; retry_count: number; timeout_ms: number;
  auth_type: string; auth_config: Record<string, unknown>; metadata: Record<string, unknown>;
  supports_balance: boolean; supports_validation: boolean; supports_refund: boolean;
  low_balance_threshold_cents: number;
};

type MappingRow = {
  id: string; package_id: string; supplier_id: string; supplier_product_id: string;
  supplier_cost_cents: number; priority: number; enabled: boolean; metadata: Record<string, unknown>;
  suppliers: SupplierRow;
};

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function resolveCredentials(supplierCode: string): Record<string, string> {
  const prefix = `SUPPLIER_${supplierCode.toUpperCase()}_`;
  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix) && v) {
      creds[k.slice(prefix.length).toLowerCase()] = v;
    }
  }
  return creds;
}

function toConfig(row: SupplierRow): SupplierConfig {
  return {
    id: row.id,
    code: row.code,
    adapter: row.adapter,
    apiUrl: row.api_url,
    sandboxApiUrl: row.sandbox_api_url,
    environment: row.environment as 'sandbox' | 'live',
    timeoutMs: row.timeout_ms,
    retryCount: row.retry_count,
    authType: row.auth_type,
    authConfig: row.auth_config,
    metadata: row.metadata,
    credentials: resolveCredentials(row.code),
  };
}

async function logTransaction(
  db: any,
  params: {
    orderId?: string; supplierId: string; mappingId?: string; idempotencyKey?: string;
    action: string; status: string; supplierReference?: string;
    requestPayload?: unknown; responsePayload?: unknown; errorMessage?: string;
    attempt: number; durationMs?: number;
  }
) {
  await (db.from('supplier_transactions') as any).insert({
    order_id: params.orderId || null,
    supplier_id: params.supplierId,
    mapping_id: params.mappingId || null,
    idempotency_key: params.idempotencyKey || null,
    action: params.action,
    status: params.status,
    supplier_reference: params.supplierReference || null,
    request_payload: params.requestPayload || null,
    response_payload: params.responsePayload || null,
    error_message: params.errorMessage || null,
    attempt: params.attempt,
    duration_ms: params.durationMs || null,
  });
}

async function updateSupplierStatus(db: any, supplierId: string, success: boolean, error?: string) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (success) {
    update.last_success_at = new Date().toISOString();
  } else {
    update.last_failure_at = new Date().toISOString();
    update.last_error = error || 'Unknown error';
  }
  await (db.from('suppliers') as any).update(update).eq('id', supplierId);
}

async function finalizeConfirmedSupplierFailure(
  db: any,
  supplier: SupplierRow,
  supplierTransactionId: string,
  error: string,
): Promise<{ applied: boolean; error?: string }> {
  // The atomic reconciliation RPC is intentionally restricted to the active
  // FazerCards adapter. Other adapters must remain recoverable rather than
  // being sent through a FazerCards-specific finalization boundary.
  if (supplier.code !== 'fazercards' || supplier.adapter !== 'custom') {
    return { applied: false, error: 'Supplier failure requires controlled recovery.' };
  }

  const { data, error: rpcError } = await db.rpc('finalize_supplier_reconciliation', {
    p_supplier_transaction_id: supplierTransactionId,
    p_outcome: 'failed',
    p_actor: 'fulfillment_system',
    p_fail_reason: error,
  });
  if (rpcError) return { applied: false, error: 'Failed to atomically finalize supplier failure.' };

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.out_outcome === 'applied' || result?.out_outcome === 'already-finalized') {
    return { applied: true };
  }

  return { applied: false, error: 'Supplier failure requires reconciliation recovery.' };
}

// ─── Fulfillment Authorization Gate ──────────────────────────────────────────
//
// canFulfill(order) is TRUE only when:
// 1. Payment is VERIFIED
// 2. Fulfillment has NOT already completed
// 3. No existing active/duplicate supplier fulfillment that should be reused

export type OrderForGate = {
  id?: string;
  status?: string;
  payment_status: string;
  fulfillment_status: string;
};

export function canFulfill(order: OrderForGate): boolean {
  return (
    order.payment_status === 'VERIFIED' &&
    order.fulfillment_status !== 'COMPLETED' &&
    order.fulfillment_status !== 'PROCESSING'
  );
}

// ─── Start Fulfillment ──────────────────────────────────────────────────────
//
// Called after payment verification (manual or automatic).
// Checks the gate, sets fulfillment_status = PROCESSING, then calls
// the supplier. Never triggers FazerCards unless canFulfill is true.

export async function startFulfillment(orderId: string, db?: any): Promise<{
  success: boolean;
  error?: string;
  supplierReference?: string;
  alreadyFulfilled?: boolean;
  supplierId?: string;
}> {
  const client = db || getDb();
  if (!client) return { success: false, error: 'Database not configured' };

  // 1. Load order and check the fulfillment gate
  const { data: order } = await (client.from('orders') as any)
    .select('id, status, payment_status, fulfillment_status, package_id, player_inputs, supplier_mapping_id')
    .eq('id', orderId)
    .maybeSingle() as any;

  if (!order) return { success: false, error: 'Order not found' };

  if (!canFulfill(order)) {
    if (order.fulfillment_status === 'COMPLETED') {
      return { success: true, alreadyFulfilled: true };
    }
    if (order.fulfillment_status === 'PROCESSING') {
      return { success: false, error: 'Fulfillment already in progress' };
    }
    return { success: false, error: 'Payment not verified — fulfillment not authorized' };
  }

  // 2. Atomically claim the order by transitioning NOT_STARTED → PROCESSING.
  // The complete_fulfillment RPC uses SELECT ... FOR UPDATE, so two concurrent
  // calls serialize on the row. The first call transitions and returns
  // out_transitioned=true. The second call sees PROCESSING (already set by
  // the first) and returns out_transitioned=false — it aborts without
  // calling the supplier. This is the atomic claim that prevents duplicate
  // supplier orders.
  const { data: claimResult, error: rpcError } = await client.rpc('complete_fulfillment', {
    p_order_id: orderId,
    p_fulfillment_status: 'PROCESSING',
    p_actor_email: 'fulfillment_system',
    p_note: 'Supplier fulfillment started',
  });

  if (rpcError) {
    return { success: false, error: 'Failed to set fulfillment status: ' + rpcError.message };
  }

  const claimRow = Array.isArray(claimResult) ? claimResult[0] : claimResult;
  if (!claimRow?.out_transitioned) {
    // Another request already claimed this order — abort without calling supplier
    return { success: false, error: 'Fulfillment already in progress' };
  }

  // 3. Extract player inputs
  const playerInputs = order.player_inputs || {};
  const playerId = playerInputs.user_id || playerInputs.player_id || '';
  const serverId = playerInputs.server_id || playerInputs.serverId || '';

  // 4. Call the existing fulfillOrder function, passing the captured mapping id
  const result = await fulfillOrder(orderId, order.package_id, playerId, serverId, client, order.supplier_mapping_id);

  // 5. Update fulfillment status based on result
  if (result.success) {
    // Supplier order created — status stays PROCESSING (not COMPLETED yet)
    // Only supplier status polling can set COMPLETED
    await client.rpc('complete_fulfillment', {
      p_order_id: orderId,
      p_fulfillment_status: 'PROCESSING',
      p_actor_email: 'fulfillment_system',
      p_note: `Supplier order created: ${result.supplierReference || 'N/A'}`,
    });
    // Fire-and-forget immediate polling so terminal supplier status is
    // reflected within seconds, not the 3-minute cron interval.
    pollImmediately(orderId, client).catch(() => {});
  }

  return {
    success: result.success,
    error: result.error,
    supplierReference: result.supplierReference ?? undefined,
    alreadyFulfilled: (result as any).alreadyFulfilled,
    supplierId: (result as any).supplierId,
  };
}

// ─── Immediate Poll-After-Create ──────────────────────────────────────────────
//
// After a supplier order is created, poll FazerCards immediately with a short
// backoff schedule (2s, 5s, 10s, 20s). If the supplier reports a terminal
// status on any poll, the order transitions right away — no waiting for cron.
// If all attempts return PROCESSING, the order stays in flight and the 3-minute
// cron reconciliation picks it up as a fallback.

const IMMEDIATE_POLL_DELAYS_MS = [2000, 5000, 10000, 20000];

export async function pollImmediately(orderId: string, db: any): Promise<void> {
  for (const delay of IMMEDIATE_POLL_DELAYS_MS) {
    await sleep(delay);
    const result = await pollFulfillmentStatus(orderId, db);
    if (result.fulfillmentStatus === 'COMPLETED' || result.fulfillmentStatus === 'FAILED') {
      return;
    }
  }
}

// ─── Poll Supplier Status ───────────────────────────────────────────────────
// accordingly. Only COMPLETED from supplier → COMPLETED for order.

export async function pollFulfillmentStatus(orderId: string, db?: any): Promise<{
  success: boolean;
  fulfillmentStatus?: string;
  error?: string;
}> {
  const client = db || getDb();
  if (!client) return { success: false, error: 'Database not configured' };

  // Find the supplier transaction for this order
  const { data: tx } = await (client.from('supplier_transactions') as any)
    .select('id, supplier_id, supplier_reference, status')
    .eq('order_id', orderId)
    .eq('action', 'create_order')
    .in('status', ['submitted', 'success', 'pending'])
    .maybeSingle();

  if (!tx || !tx.supplier_reference) {
    return { success: false, error: 'No supplier reference found' };
  }

  // Load the supplier
  const { data: supplier } = await (client.from('suppliers') as any)
    .select('*')
    .eq('id', tx.supplier_id)
    .maybeSingle();

  if (!supplier) return { success: false, error: 'Supplier not found' };

  const config = toConfig(supplier as SupplierRow);
  const adapter = getAdapter(supplier.adapter, supplier.code);

  try {
    const supplierStatus = await adapter.queryStatus(config, tx.supplier_reference);

    if (supplierStatus.status === 'completed') {
      const { data: finalization, error: finalizationError } = await client.rpc('finalize_supplier_reconciliation', {
        p_supplier_transaction_id: tx.id,
        p_outcome: 'completed',
        p_actor: 'fulfillment_system',
        p_fail_reason: null,
      });
      if (finalizationError) return { success: false, error: 'Failed to finalize supplier completion.' };
      const result = Array.isArray(finalization) ? finalization[0] : finalization;
      if (!result || !['applied', 'already-finalized'].includes(result.out_outcome)) {
        return { success: false, error: 'Supplier completion requires reconciliation recovery.' };
      }
      return { success: true, fulfillmentStatus: 'COMPLETED' };
    }

    if (supplierStatus.status === 'failed' && supplierStatus.error) {
      const { data: finalization, error: finalizationError } = await client.rpc('finalize_supplier_reconciliation', {
        p_supplier_transaction_id: tx.id,
        p_outcome: 'failed',
        p_actor: 'fulfillment_system',
        p_fail_reason: supplierStatus.error,
      });
      if (finalizationError) return { success: false, error: 'Failed to finalize supplier failure.' };
      const result = Array.isArray(finalization) ? finalization[0] : finalization;
      if (!result || !['applied', 'already-finalized'].includes(result.out_outcome)) {
        return { success: false, error: 'Supplier failure requires reconciliation recovery.' };
      }
      return { success: true, fulfillmentStatus: 'FAILED' };
    }

    return { success: true, fulfillmentStatus: 'PROCESSING' };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Status query failed';
    return { success: false, error: errMsg };
  }
}

// ─── Mapping eligibility ─────────────────────────────────────────────────────
//
// A mapping is eligible only if:
// 1. The mapping itself is enabled
// 2. The supplier is enabled
// 3. The mapping metadata contains a valid supplier_category_id + supplier_offer_id
//    (for FazerCards: metadata.category_id and metadata.offer_id)

function isMappingEligible(mapping: MappingRow): boolean {
  if (!mapping.enabled) return false;
  if (!mapping.suppliers?.enabled) return false;
  const meta = mapping.metadata || {};
  const categoryId = meta.category_id as string | undefined;
  const offerId = meta.offer_id as string | undefined;
  if (!categoryId || !offerId) return false;
  return true;
}

export async function fulfillOrder(
  orderId: string,
  packageId: string,
  playerId: string,
  serverId?: string,
  db?: any,
  capturedMappingId?: string | null,
) {
  const client = db || getDb();
  if (!client) return { success: false, error: 'Database not configured' };

  // 1. Check for an existing active or pending transaction (already fulfilled or in-flight)
  const { data: existingTx } = await (client.from('supplier_transactions') as any)
    .select('id, status, supplier_reference, supplier_id, idempotency_key, mapping_id')
    .eq('order_id', orderId)
    .eq('action', 'create_order')
    .in('status', ['submitted', 'success', 'pending'])
    .maybeSingle();

  if (existingTx) {
    if (existingTx.status === 'pending') {
      return resumePendingFulfillment(client, orderId, packageId, playerId, serverId, existingTx);
    }
    return { success: true, supplierReference: existingTx.supplier_reference, alreadyFulfilled: true };
  }

  // 2. Count prior confirmed failures to generate a unique idempotency key per retry.
  const { count: priorFailures } = await (client.from('supplier_transactions') as any)
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('action', 'create_order')
    .in('status', ['failed', 'timeout']);

  // 3. Resolve eligible supplier mappings.
  //    Prefer the mapping captured at order creation time (supplier_mapping_id
  //    on the orders row) so later catalog changes don't alter the fulfillment
  //    target. Fall back to a live lookup only if no mapping was captured.
  let activeMappings: MappingRow[] = [];

  if (capturedMappingId) {
    const { data: captured } = await (client.from('supplier_package_mappings') as any)
      .select('*, suppliers(*)')
      .eq('id', capturedMappingId)
      .maybeSingle();
    if (captured) {
      activeMappings = [captured as unknown as MappingRow];
    }
  }

  if (activeMappings.length === 0) {
    const { data: mappings } = await (client.from('supplier_package_mappings') as any)
      .select('*, suppliers(*)')
      .eq('package_id', packageId)
      .eq('enabled', true)
      .order('priority', { ascending: false });

    activeMappings = ((mappings || []) as unknown as MappingRow[])
      .filter((m) => m.suppliers?.enabled);
  }

  // 4. Validate that every mapping has the required supplier fields.
  const eligibleMappings = activeMappings.filter(isMappingEligible);

  if (eligibleMappings.length === 0) {
    return { success: false, error: 'No active supplier mapping for this package' };
  }

  // 5. Attempt fulfillment with each eligible supplier (failover order by priority).
  for (const mapping of eligibleMappings) {
    const supplier = mapping.suppliers;
    const config = toConfig(supplier);
    const adapter = getAdapter(supplier.adapter, supplier.code);
    const retryAttempt = (priorFailures ?? 0) + 1;
    const idempotencyKey = `order_${orderId}_supplier_${supplier.id}_retry_${retryAttempt}`;

    // Build FazerCards fields from player inputs.
    const fazercardsFields: Record<string, string> = {};
    if (playerId) fazercardsFields.player_id = playerId;
    if (serverId) fazercardsFields.server_id = serverId;
    const enrichedMetadata = { ...mapping.metadata, fields: fazercardsFields };

    // Pre-persist a 'pending' transaction BEFORE calling the supplier.
    const { data: pendingTx, error: insertError } = await (client.from('supplier_transactions') as any)
      .insert({
        order_id: orderId,
        supplier_id: supplier.id,
        mapping_id: mapping.id,
        idempotency_key: idempotencyKey,
        action: 'create_order',
        status: 'pending',
        request_payload: { product_id: mapping.supplier_product_id, player_id: playerId },
        attempt: 1,
      })
      .select()
      .single();

    if (insertError) {
      return { success: false, error: 'Fulfillment already in progress for this order' };
    }

    for (let attempt = 1; attempt <= supplier.retry_count; attempt++) {
      const start = Date.now();

      try {
        const result: FulfillmentResult = await adapter.createOrder(config, {
          idempotencyKey,
          supplierProductId: mapping.supplier_product_id,
          playerId,
          serverId,
          quantity: 1,
          metadata: enrichedMetadata,
        });

        const durationMs = Date.now() - start;

        await (client.from('supplier_transactions') as any)
          .update({
            // A false result is not terminal until the adapter explicitly
            // classifies it as failed and the atomic RPC accepts it.
            status: result.success ? 'submitted' : 'pending',
            supplier_reference: result.supplierReference || null,
            response_payload: result.rawResponse,
            error_message: result.error || null,
            duration_ms: durationMs,
            attempt,
          })
          .eq('id', pendingTx.id);

        await updateSupplierStatus(client, supplier.id, result.success, result.error || undefined);

        if (result.success) {
          return { success: true, supplierReference: result.supplierReference, supplierId: supplier.id };
        }

        if (result.status === 'failed') {
          const failure = await finalizeConfirmedSupplierFailure(
            client,
            supplier,
            pendingTx.id,
            result.error || 'Supplier rejected the order',
          );
          return {
            success: false,
            error: failure.applied ? result.error || 'Supplier rejected the order' : failure.error,
          };
        }

        // Pending/processing responses are ambiguous. Keep the transaction
        // pending and recover with the same idempotency key; never fail over.
        return {
          success: false,
          error: result.error || 'Supplier response is pending and requires reconciliation.',
        };
      } catch (e) {
        const durationMs = Date.now() - start;
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        // Any thrown create error has an unknown supplier outcome. Keep the
        // pre-persisted transaction pending and reuse its idempotency key.
        await (client.from('supplier_transactions') as any)
          .update({
            error_message: errMsg,
            duration_ms: durationMs,
            attempt,
          })
          .eq('id', pendingTx.id);

        await updateSupplierStatus(client, supplier.id, false, errMsg);
        return { success: false, error: `Supplier response is unknown and remains pending. (${errMsg})` };
      }
    }
  }

  return { success: false, error: 'Supplier fulfillment requires controlled recovery.' };
}

async function resumePendingFulfillment(
  db: any,
  orderId: string,
  packageId: string,
  playerId: string,
  serverId: string | undefined,
  pendingTx: { id: string; supplier_id: string; idempotency_key: string; mapping_id: string | null },
) {
  // Load the supplier and mapping to replay the call with the same idempotency key
  const { data: supplier } = await (db.from('suppliers') as any)
    .select('*')
    .eq('id', pendingTx.supplier_id)
    .maybeSingle();

  if (!supplier) {
    // A missing supplier is not evidence that the upstream request failed.
    // Leave the transaction pending for controlled recovery.
    return { success: false, error: 'Supplier for pending transaction requires controlled recovery' };
  }

  const config = toConfig(supplier as SupplierRow);
  const adapter = getAdapter(supplier.adapter, supplier.code);

  // Load the mapping for metadata
  let mapping: MappingRow | null = null;
  if (pendingTx.mapping_id) {
    const { data: mappingData } = await (db.from('supplier_package_mappings') as any)
      .select('*, suppliers(*)')
      .eq('id', pendingTx.mapping_id)
      .maybeSingle();
    mapping = mappingData as MappingRow | null;
  }

  const fazercardsFields: Record<string, string> = {};
  if (playerId) fazercardsFields.player_id = playerId;
  if (serverId) fazercardsFields.server_id = serverId;
  const enrichedMetadata = { ...(mapping?.metadata || {}), fields: fazercardsFields };

  const start = Date.now();
  try {
    // Reuse the SAME idempotency key — the supplier returns the original order
    // if it was created, or creates it now if it wasn't.
    const result: FulfillmentResult = await adapter.createOrder(config, {
      idempotencyKey: pendingTx.idempotency_key,
      supplierProductId: mapping?.supplier_product_id || '',
      playerId,
      serverId,
      quantity: 1,
      metadata: enrichedMetadata,
    });

    const durationMs = Date.now() - start;

    await (db.from('supplier_transactions') as any)
      .update({
        status: result.success ? 'submitted' : 'pending',
        supplier_reference: result.supplierReference || null,
        response_payload: result.rawResponse,
        error_message: result.error || null,
        duration_ms: durationMs,
      })
      .eq('id', pendingTx.id);

    await updateSupplierStatus(db, supplier.id, result.success, result.error || undefined);

    if (!result.success && result.status === 'failed') {
      const failure = await finalizeConfirmedSupplierFailure(
        db,
        supplier as SupplierRow,
        pendingTx.id,
        result.error || 'Supplier rejected the order',
      );
      return {
        success: false,
        supplierId: supplier.id,
        error: failure.applied ? result.error || 'Supplier rejected the order' : failure.error,
      };
    }

    return {
      success: result.success,
      supplierReference: result.supplierReference || undefined,
      supplierId: supplier.id,
      error: result.error || undefined,
    };
  } catch (e) {
    const durationMs = Date.now() - start;
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    // Any thrown error has an unknown supplier outcome. Keep the transaction
    // pending and reuse the same idempotency key on recovery.
    await (db.from('supplier_transactions') as any)
      .update({
        error_message: errMsg,
        duration_ms: durationMs,
      })
      .eq('id', pendingTx.id);

    await updateSupplierStatus(db, supplier.id, false, errMsg);
    return { success: false, error: `Supplier response is unknown and remains pending. (${errMsg})` };
  }
}

export async function testSupplierConnection(supplierId: string) {
  const db = getDb();
  if (!db) return { success: false, message: 'Database not configured', latencyMs: 0 };

  const { data: supplier } = await (db.from('suppliers') as any).select('*').eq('id', supplierId).maybeSingle();
  if (!supplier) return { success: false, message: 'Supplier not found', latencyMs: 0 };

  const config = toConfig(supplier as SupplierRow);
  const adapter = getAdapter(supplier.adapter, supplier.code);
  const result = await adapter.testConnection(config);

  await logTransaction(db, {
    supplierId, action: 'test', status: result.success ? 'success' : 'failed',
    errorMessage: result.success ? undefined : result.message, attempt: 1, durationMs: result.latencyMs,
  });

  await updateSupplierStatus(db, supplierId, result.success, result.success ? undefined : result.message);
  return result;
}

export async function checkSupplierBalance(supplierId: string) {
  const db = getDb();
  if (!db) return { success: false, error: 'Database not configured' };

  const { data: supplier } = await (db.from('suppliers') as any).select('*').eq('id', supplierId).maybeSingle();
  if (!supplier) return { success: false, error: 'Supplier not found' };

  const config = toConfig(supplier as SupplierRow);
  const adapter = getAdapter(supplier.adapter, supplier.code);
  const start = Date.now();

  try {
    const result = await adapter.getBalance(config);
    await (db.from('suppliers') as any).update({
      cached_balance_cents: result.balanceCents,
      balance_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', supplierId);
    await logTransaction(db, {
      supplierId, action: 'balance', status: 'success', attempt: 1, durationMs: Date.now() - start,
      responsePayload: result,
    });
    await updateSupplierStatus(db, supplierId, true);
    return { success: true, ...result };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Balance check failed';
    await logTransaction(db, {
      supplierId, action: 'balance', status: 'failed', errorMessage: errMsg, attempt: 1, durationMs: Date.now() - start,
    });
    await updateSupplierStatus(db, supplierId, false, errMsg);
    return { success: false, error: errMsg };
  }
}

export async function syncSupplierCatalog(supplierId: string) {
  const db = getDb();
  if (!db) return { success: false, error: 'Database not configured', products: [] };

  const { data: supplier } = await (db.from('suppliers') as any).select('*').eq('id', supplierId).maybeSingle();
  if (!supplier) return { success: false, error: 'Supplier not found', products: [] };

  const config = toConfig(supplier as SupplierRow);
  const adapter = getAdapter(supplier.adapter, supplier.code);

  try {
    const products = await adapter.getCatalog(config);
    await updateSupplierStatus(db, supplierId, true);
    return { success: true, products };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Catalog sync failed';
    await updateSupplierStatus(db, supplierId, false, errMsg);
    return { success: false, error: errMsg, products: [] };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

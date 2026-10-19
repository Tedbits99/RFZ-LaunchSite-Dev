import { createClient } from "npm:@supabase/supabase-js@2";
import {
  hasValidReconciliationSecret,
  getReconciliationDecision,
  isInFlightSupplierTransactionStatus,
  isEnabledFazerCardsSupplier,
  authorizeFulfillmentHandoffDispatch,
  type DispatchAuthDecision,
} from "../_shared/reconciliationSecurity.ts";
import {
  processFulfillmentHandoffBatch,
  getFulfillmentHandoffSecret,
  json as handoffJson,
} from "../_shared/fulfillmentHandoffWorker.ts";

/*
  Auto-reconciliation worker: polls FazerCards for supplier orders that are
  still in flight and transitions fulfillment status accordingly.

  Safety rules:
  - COMPLETED is written ONLY when the supplier explicitly reports a
    completed/success status.
  - FAILED is written ONLY when the supplier explicitly reports failure
    AND provides a fail_reason. Ambiguous responses stay PROCESSING.
  - Never creates orders or payments; read + status transitions only.

  Scheduled every 3 minutes via pg_cron. State transitions are written
  directly with the service-role client (this mirrors the same transition
  rules as the complete_fulfillment RPC, which cannot be used here because
  its operator guard keys on the caller's JWT claims, and pg_cron calls
  arrive without user claims).
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const FAZERCARDS_BASE = "https://api.fzr.cards/api/v2";
const POLL_BATCH_LIMIT = 25;

/*
  Fulfillment handoff dispatch route.

  The platform edge router never registered the dedicated fulfillment-handoff
  slugs despite successful deployments, so the handoff worker is also served
  here at POST ?dispatch=fulfillment-handoff. Authenticated ONLY by the
  fulfillment handoff cron secret (fulfillment_handoff_secret) via the
  existing X-Cron-Secret header and constant-time comparator — never by this
  function's auto_recon_secret alone, and never without a valid secret.
  Unauthenticated requests and requests presenting any other secret are
  rejected with 401 before any queue claim or supplier access. Behavior of
  the scheduled reconciliation path is unchanged; with no query string this
  function behaves exactly as before.

  This dispatch NEVER creates supplier orders on its own; it drives the same
  canonical fulfillment pipeline (verified-payment gate, atomic
  complete_fulfillment claim, supplier transaction idempotency) as the
  reviewed handoff worker.
*/
async function handleFulfillmentHandoffDispatch(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.searchParams.get("dispatch") !== "fulfillment-handoff") return null;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return handoffJson({ error: "Service unavailable." }, 503);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Sole dispatch credential: the fulfillment handoff cron secret.
  const handoffSecret = await getFulfillmentHandoffSecret(db);
  const decision: DispatchAuthDecision = authorizeFulfillmentHandoffDispatch({
    dispatch: url.searchParams.get("dispatch"),
    providedSecret: req.headers.get("X-Cron-Secret"),
    configuredHandoffSecret: handoffSecret,
  });
  if (decision === "unavailable") {
    return handoffJson({ error: "Service unavailable." }, 503);
  }
  if (decision === "unauthorized") {
    return handoffJson({ error: "Unauthorized." }, 401);
  }

  // Authenticated health probe: zero queue claims, zero supplier requests.
  if (url.searchParams.get("health") === "1") {
    return handoffJson({ ok: true, worker: "auto-reconciliation:fulfillment-handoff", claimed: 0 });
  }

  return await processFulfillmentHandoffBatch(db);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const dispatchResponse = await handleFulfillmentHandoffDispatch(req);
    if (dispatchResponse) return dispatchResponse;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const API_KEY = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Service unavailable." }, 503);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: secretRow, error: secretError } = await db
      .from("_cron_secrets")
      .select("value")
      .eq("key", "auto_recon_secret")
      .maybeSingle();
    const configuredSecret = typeof secretRow?.value === "string" ? secretRow.value : null;
    if (secretError || !configuredSecret) {
      return json({ error: "Service unavailable." }, 503);
    }
    if (!hasValidReconciliationSecret(req.headers.get("X-Cron-Secret"), configuredSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }
    if (!API_KEY) {
      return json({ error: "Service unavailable." }, 503);
    }

    // Orders with an in-flight supplier transaction.
    const { data: txs } = await db
      .from("supplier_transactions")
      .select("id, order_id, supplier_id, supplier_reference, status, created_at")
      .eq("action", "create_order")
      .in("status", ["submitted", "pending"])
      .order("created_at", { ascending: true })
      .limit(POLL_BATCH_LIMIT);

    if (!txs || txs.length === 0) {
      return json({ polled: 0, reconciled: 0, errors: 0 });
    }

    let polled = 0;
    let reconciled = 0;
    let errors = 0;

    for (const tx of txs as Record<string, any>[]) {
      if (!tx.supplier_reference || !tx.supplier_id) continue;
      if (!isInFlightSupplierTransactionStatus(tx.status)) continue;

      const { data: supplier } = await db
        .from("suppliers")
        .select("id, code, adapter, enabled")
        .eq("id", tx.supplier_id)
        .maybeSingle();
      if (!supplier) continue;
      if (!isEnabledFazerCardsSupplier(supplier)) continue;

      polled++;
      try {
        const res = await fetch(
          `${FAZERCARDS_BASE}/orders/${encodeURIComponent(tx.supplier_reference)}`,
          { method: "GET", headers: { "Content-Type": "application/json", "X-API-Key": API_KEY } },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) {
          await db
            .from("supplier_transactions")
            .update({ error_message: `Poll HTTP ${res.status}` })
            .eq("id", tx.id)
            .in("status", ["submitted", "pending"]);
          errors++;
          continue;
        }

        const order = (data as Record<string, any>)?.order ?? data;
        const rawStatus = String(order?.status ?? "");
        const mapped = getReconciliationDecision(rawStatus, order?.fail_reason);

        if (mapped === "completed") {
          const { data: finalization, error: finalizationError } = await db.rpc(
            "finalize_supplier_reconciliation",
            {
              p_supplier_transaction_id: tx.id,
              p_outcome: "completed",
              p_actor: "auto-reconciliation",
              p_fail_reason: null,
            },
          );
          const result = Array.isArray(finalization) ? finalization[0] : finalization;
          if (finalizationError || !result || !["applied", "already-finalized"].includes(result.out_outcome)) {
            errors++;
          } else {
            reconciled++;
          }
        } else if (mapped === "failed" && order?.fail_reason) {
          const { data: finalization, error: finalizationError } = await db.rpc(
            "finalize_supplier_reconciliation",
            {
              p_supplier_transaction_id: tx.id,
              p_outcome: "failed",
              p_actor: "auto-reconciliation",
              p_fail_reason: String(order.fail_reason),
            },
          );
          const result = Array.isArray(finalization) ? finalization[0] : finalization;
          if (finalizationError || !result || !["applied", "already-finalized"].includes(result.out_outcome)) {
            errors++;
          } else {
            reconciled++;
          }
        } else {
          // Still processing, or ambiguous failure without a reason — stay in flight.
        }
      } catch {
        errors++;
      }
    }

    return json({ polled, reconciled, errors });
  } catch {
    return json({ error: "Reconciliation failed" }, 500);
  }
});

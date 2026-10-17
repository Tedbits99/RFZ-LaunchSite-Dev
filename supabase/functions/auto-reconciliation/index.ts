import { createClient } from "npm:@supabase/supabase-js@2";

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

function mapSupplierStatus(raw: string): "completed" | "failed" | "processing" {
  const s = raw.toLowerCase();
  if (s.includes("complet") || s.includes("success") || s.includes("done")) return "completed";
  if (s.includes("fail") || s.includes("error") || s.includes("cancel")) return "failed";
  return "processing";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const API_KEY = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY") || "";
    const CRON_SECRET = "rfz_recon_a8f3k2m9x7q1w4z6b5c8d0e2f3a1b4c7";
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Service unavailable." }, 503);
    }
    if (req.headers.get("X-Cron-Secret") !== CRON_SECRET) {
      return json({ error: "Unauthorized." }, 401);
    }
    const db = createClient(SUPABASE_URL, SERVICE_KEY);

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

      const { data: supplier } = await db
        .from("suppliers")
        .select("id, code, adapter, enabled")
        .eq("id", tx.supplier_id)
        .maybeSingle();
      if (!supplier) continue;

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
            .eq("id", tx.id);
          errors++;
          continue;
        }

        const order = (data as Record<string, any>)?.order ?? data;
        const rawStatus = String(order?.status ?? "");
        const mapped = mapSupplierStatus(rawStatus);

        if (mapped === "completed") {
          // Genuine supplier success — the only path to COMPLETED.
          await db.from("supplier_transactions")
            .update({ status: "success", error_message: null })
            .eq("id", tx.id);
          // Transition rules mirror complete_fulfillment: only PROCESSING ->
          // COMPLETED is allowed here. Orders already terminal are untouched.
          const { data: ord } = await db
            .from("orders")
            .select("id, fulfillment_status, payment_status")
            .eq("id", tx.order_id)
            .maybeSingle();
          const o = (ord as Record<string, any>) || null;
          if (o && o.payment_status === "VERIFIED" && o.fulfillment_status === "PROCESSING") {
            const { error: updError } = await db
              .from("orders")
              .update({ fulfillment_status: "COMPLETED", status: "COMPLETED", updated_at: new Date().toISOString() })
              .eq("id", tx.order_id)
              .eq("fulfillment_status", "PROCESSING");
            if (updError) {
              errors++;
            } else {
              await db.from("order_timeline").insert({
                order_id: tx.order_id,
                status: "COMPLETED",
                actor_email: "auto-reconciliation",
                note: `Supplier confirmed completion: ${tx.supplier_reference}`,
              });
              reconciled++;
            }
          } else {
            reconciled++; // tx confirmed success; order already terminal — no-op
          }
        } else if (mapped === "failed" && order?.fail_reason) {
          // Explicit supplier failure with a reason — safe to mark FAILED.
          await db.from("supplier_transactions")
            .update({ status: "failed", error_message: String(order.fail_reason) })
            .eq("id", tx.id);
          const { data: ord } = await db
            .from("orders")
            .select("id, fulfillment_status, payment_status")
            .eq("id", tx.order_id)
            .maybeSingle();
          const o = (ord as Record<string, any>) || null;
          if (o && o.payment_status === "VERIFIED" && o.fulfillment_status === "PROCESSING") {
            const { error: updError } = await db
              .from("orders")
              .update({ fulfillment_status: "FAILED", status: "FULFILLMENT_FAILED", updated_at: new Date().toISOString() })
              .eq("id", tx.order_id)
              .eq("fulfillment_status", "PROCESSING");
            if (updError) {
              errors++;
            } else {
              await db.from("order_timeline").insert({
                order_id: tx.order_id,
                status: "FAILED",
                actor_email: "auto-reconciliation",
                note: `Supplier reported failure (${tx.supplier_reference}): ${order.fail_reason}`,
              });
              reconciled++;
            }
          } else {
            reconciled++; // tx confirmed failed; order already terminal — no-op
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

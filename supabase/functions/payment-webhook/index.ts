// v2: transactional email integration
import { createClient } from "npm:@supabase/supabase-js@2";

/*
  PayMongo webhook processor + fulfillment trigger + transactional email.

  Runs inside the Edge Function runtime, which holds the managed secrets:
  - PAYMENT_PAYMONGO_WEBHOOK_SECRET  (HMAC signature verification)
  - SUPPLIER_FAZERCARDS_API_KEY      (supplier order creation)
  - SUPABASE_SERVICE_ROLE_KEY
  - SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD (Titan Business Email)

  POST ?provider=paymongo   (same URL contract as the previous Next.js route)

  Flow (identical to the previous Next.js handler):
  1. Load enabled automated provider config from payment_config
  2. Verify the PayMongo HMAC signature (fail closed)
  3. Resolve the order from metadata / provider reference / nested payment id
  4. Idempotency check + webhook transaction log
  5. Amount check against order.total_cents for PAID
  6. verify_payment RPC -> PAYMENT_VERIFIED (service role passes the operator guard)
  7. Send payment-success email (once per order, duplicate-guarded)
  8. Fulfillment: gate -> atomic complete_fulfillment claim -> pending supplier
     transaction -> FazerCards create-order with idempotency key -> status updates.
     Mirrors lib/suppliers/fulfillment.ts exactly. FazerCards status polling
     (separate poll function) remains the only path that sets COMPLETED.
  9. On fulfillment failure, send fulfillment-failed email (once per order).
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const FAZERCARDS_BASE = "https://api.fzr.cards/api/v2";
const FULFILLMENT_TIMEOUT_MS = 25000;
const EMAIL_FUNCTION_PATH = "/functions/v1/send-transactional-email";

interface OrderEmailData {
  order_id: string;
  to: string;
  order_reference: string;
  customer_name: string;
  package_name: string;
  total_php: string;
}

async function loadOrderForEmail(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<OrderEmailData | null> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, reference, email, customer_name, total_cents, package_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return null;
  const o = order as Record<string, any>;
  let packageName = "";
  if (o.package_id) {
    const { data: pkg } = await supabase
      .from("packages")
      .select("name")
      .eq("id", o.package_id)
      .maybeSingle();
    packageName = (pkg as any)?.name || "";
  }
  const totalPhp = `₱${(o.total_cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  return {
    order_id: orderId,
    to: o.email,
    order_reference: o.reference,
    customer_name: o.customer_name,
    package_name: packageName,
    total_php: totalPhp,
  };
}

async function sendPaymentSuccessEmail(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<void> {
  try {
    const orderData = await loadOrderForEmail(supabase, orderId);
    if (!orderData || !orderData.to) return;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!SUPABASE_URL || !ANON_KEY) return;

    await fetch(`${SUPABASE_URL}${EMAIL_FUNCTION_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ANON_KEY}`,
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({
        ...orderData,
        template: "payment_success",
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Email failure must not affect webhook processing
  }
}

async function sendFulfillmentFailedEmail(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  errorDetail: string,
): Promise<void> {
  try {
    const orderData = await loadOrderForEmail(supabase, orderId);
    if (!orderData || !orderData.to) return;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!SUPABASE_URL || !ANON_KEY) return;

    await fetch(`${SUPABASE_URL}${EMAIL_FUNCTION_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ANON_KEY}`,
        "apikey": ANON_KEY,
      },
      body: JSON.stringify({
        ...orderData,
        template: "fulfillment_failed",
        error_detail: errorDetail,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Email failure must not affect webhook processing
  }
}

interface WebhookOutcome {
  orderId: string | null;
  providerReference: string | null;
  status: string;
  amountCents: number | null;
  rawPayload: Record<string, unknown> | null;
  error: string | null;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validatePayMongoWebhook(
  secret: string,
  isTestMode: boolean,
  body: string,
  sigHeader: string,
): Promise<WebhookOutcome> {
  // Fail closed: an unverifiable webhook must never be accepted.
  if (!secret || !sigHeader) {
    return { orderId: null, providerReference: null, status: "", amountCents: null, rawPayload: null, error: "Webhook signature missing or webhook secret not configured" };
  }
  const parts = sigHeader.split(",").reduce((acc: Record<string, string>, p) => {
    const [k, v] = p.split("=");
    acc[k?.trim()] = v;
    return acc;
  }, {});
  const ts = parts["t"];
  const sigToVerify = isTestMode ? parts["te"] : parts["li"];
  if (!ts || !sigToVerify) {
    return { orderId: null, providerReference: null, status: "", amountCents: null, rawPayload: null, error: "Malformed PayMongo signature header" };
  }
  const computed = await hmacSha256Hex(secret, `${ts}.${body}`);
  if (computed !== sigToVerify) {
    return { orderId: null, providerReference: null, status: "", amountCents: null, rawPayload: null, error: "Invalid PayMongo webhook signature" };
  }

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { orderId: null, providerReference: null, status: "", amountCents: null, rawPayload: null, error: "Could not parse webhook body" };
  }
  const eventType = parsed?.data?.attributes?.type || "";
  const resource = parsed?.data?.attributes?.data || {};
  const attrs = resource.attributes || {};
  const pmMeta = attrs.metadata || {};
  let status = "UNKNOWN";
  if (eventType.includes("payment.paid")) status = "PAID";
  else if (eventType.includes("payment.failed")) status = "FAILED";
  else if (eventType.includes("checkout_session.payment.paid")) status = "PAID";

  let providerRef = resource.id ?? null;
  if (Array.isArray(attrs.payments) && attrs.payments.length > 0 && attrs.payments[0]?.id) {
    providerRef = attrs.payments[0].id;
  }

  return {
    orderId: pmMeta.order_id || null,
    providerReference: providerRef,
    status,
    amountCents: attrs.amount ?? null,
    rawPayload: parsed,
    error: null,
  };
}

async function fazercardsCreateOrder(
  apiKey: string,
  categoryId: string,
  offerId: string,
  fields: Record<string, string>,
  idempotencyKey: string,
): Promise<{ success: boolean; supplierReference: string | null; error: string | null; rawResponse: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FULFILLMENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${FAZERCARDS_BASE}/topups/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "Idempotency-Key": idempotencyKey,
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
      supplierReference: String(order.id ?? data?.order_id ?? "") || null,
      error: null,
      rawResponse: data,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Supplier request failed";
    return { success: false, supplierReference: null, error: msg, rawResponse: null };
  } finally {
    clearTimeout(timer);
  }
}

// Mirrors lib/suppliers/fulfillment.ts startFulfillment + fulfillOrder.
// Returns quietly — fulfillment failure must not undo payment verification.
async function triggerFulfillment(supabase: ReturnType<typeof createClient>, orderId: string): Promise<void> {
  try {
    // 1. Load order and check the gate (payment VERIFIED, not already fulfilled).
    const { data: order } = await supabase
      .from("orders")
      .select("id, payment_status, fulfillment_status, package_id, player_inputs, supplier_mapping_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;
    const o = order as Record<string, any>;
    if (o.payment_status !== "VERIFIED") return;
    if (o.fulfillment_status === "COMPLETED" || o.fulfillment_status === "PROCESSING") return;

    // 2. Atomically claim the order (NOT_STARTED -> PROCESSING).
    const { data: claimResult } = await supabase.rpc("complete_fulfillment", {
      p_order_id: orderId,
      p_fulfillment_status: "PROCESSING",
      p_actor_email: "fulfillment_system",
      p_note: "Supplier fulfillment started",
    });
    const claimRow = Array.isArray(claimResult) ? claimResult[0] : claimResult;
    if (!claimRow?.out_transitioned) return;

    // 3. Resolve the supplier mapping (captured at order creation first).
    let mapping: Record<string, any> | null = null;
    if (o.supplier_mapping_id) {
      const { data: captured } = await supabase
        .from("supplier_package_mappings")
        .select("*, suppliers(*)")
        .eq("id", o.supplier_mapping_id)
        .maybeSingle();
      mapping = (captured as Record<string, any>) || null;
    }
    if (!mapping) {
      const { data: mappings } = await supabase
        .from("supplier_package_mappings")
        .select("*, suppliers(*)")
        .eq("package_id", o.package_id)
        .eq("enabled", true)
        .order("priority", { ascending: false });
      const eligible = ((mappings || []) as Record<string, any>[]).filter(
        (m) => m.enabled && m.suppliers?.enabled && m.metadata?.category_id && m.metadata?.offer_id,
      );
      mapping = eligible[0] || null;
    }
    if (!mapping || !mapping.suppliers?.enabled || !mapping.metadata?.category_id || !mapping.metadata?.offer_id) {
      await supabase.rpc("complete_fulfillment", {
        p_order_id: orderId,
        p_fulfillment_status: "FAILED",
        p_actor_email: "fulfillment_system",
        p_note: "Fulfillment failed: no active supplier mapping for this package",
      });
      return;
    }

    // 4. Check for an existing active supplier transaction (idempotency).
    const { data: existingTx } = await supabase
      .from("supplier_transactions")
      .select("id, status, supplier_reference")
      .eq("order_id", orderId)
      .eq("action", "create_order")
      .in("status", ["submitted", "success", "pending"])
      .maybeSingle();
    if (existingTx) {
      return; // already fulfilled or in-flight — nothing to do
    }

    // 5. Create the pending supplier transaction with a unique idempotency key.
    const supplier = mapping.suppliers as Record<string, any>;
    const idempotencyKey = `order_${orderId}_supplier_${supplier.id}_retry_1`;
    const { data: pendingTx, error: txError } = await supabase
      .from("supplier_transactions")
      .insert({
        order_id: orderId,
        supplier_id: supplier.id,
        mapping_id: mapping.id,
        idempotency_key: idempotencyKey,
        action: "create_order",
        status: "pending",
        request_payload: { product_id: mapping.supplier_product_id, player_id: (o.player_inputs || {}).user_id || null },
        attempt: 1,
      })
      .select()
      .single();
    if (txError || !pendingTx) {
      // Unique violation = concurrent fulfillment — abort without calling supplier.
      return;
    }

    // 6. Call the supplier.
    const playerInputs = o.player_inputs || {};
    const fields: Record<string, string> = {};
    if (playerInputs.user_id || playerInputs.player_id) {
      fields.player_id = String(playerInputs.user_id || playerInputs.player_id);
    }
    if (playerInputs.server_id || playerInputs.serverId) {
      fields.server_id = String(playerInputs.server_id || playerInputs.serverId);
    }
    const apiKey = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY") || "";
    const result = await fazercardsCreateOrder(
      apiKey,
      String(mapping.metadata.category_id),
      String(mapping.metadata.offer_id),
      fields,
      idempotencyKey,
    );

    // 7. Record the outcome (status stays PROCESSING on success; only supplier
    //    status polling sets COMPLETED).
    const isTimeout = (result.error || "").includes("abort");
    await supabase
      .from("supplier_transactions")
      .update({
        status: isTimeout ? "pending" : result.success ? "submitted" : "failed",
        supplier_reference: result.supplierReference,
        response_payload: result.rawResponse,
        error_message: result.error,
        duration_ms: null,
        attempt: 1,
      })
      .eq("id", (pendingTx as Record<string, any>).id);

    await supabase
      .from("suppliers")
      .update({
        last_success_at: result.success ? new Date().toISOString() : null,
        last_failure_at: result.success ? null : new Date().toISOString(),
        last_error: result.success ? null : result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", supplier.id);

    if (result.success) {
      await supabase.rpc("complete_fulfillment", {
        p_order_id: orderId,
        p_fulfillment_status: "PROCESSING",
        p_actor_email: "fulfillment_system",
        p_note: `Supplier order created: ${result.supplierReference || "N/A"}`,
      });
    } else if (!isTimeout) {
      await supabase.rpc("complete_fulfillment", {
        p_order_id: orderId,
        p_fulfillment_status: "FAILED",
        p_actor_email: "fulfillment_system",
        p_note: `Fulfillment failed: ${result.error || "Unknown error"}`,
      });
    }
  } catch {
    // Fulfillment failure must not undo payment verification.
  }
}

// Immediate poll-after-create: polls FazerCards with a short backoff schedule
// so terminal supplier status is reflected within seconds, not the cron interval.
// Mirrors pollImmediately() in lib/suppliers/fulfillment.ts.
const IMMEDIATE_POLL_DELAYS_MS = [2000, 5000, 10000, 20000];

async function fazercardsPollOrder(
  apiKey: string,
  supplierReference: string,
): Promise<{ status: "completed" | "failed" | "processing"; failReason: string | null }> {
  try {
    const res = await fetch(
      `${FAZERCARDS_BASE}/orders/${encodeURIComponent(supplierReference)}`,
      { method: "GET", headers: { "Content-Type": "application/json", "X-API-Key": apiKey } },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return { status: "processing", failReason: null };
    const order = (data as Record<string, any>)?.order ?? data;
    const raw = String(order?.status ?? "").toLowerCase();
    if (raw.includes("complet") || raw.includes("success") || raw.includes("done")) {
      return { status: "completed", failReason: null };
    }
    if (raw.includes("fail") || raw.includes("error") || raw.includes("cancel")) {
      return { status: "failed", failReason: order?.fail_reason ? String(order.fail_reason) : null };
    }
    return { status: "processing", failReason: null };
  } catch {
    return { status: "processing", failReason: null };
  }
}

async function pollSupplierImmediately(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
): Promise<void> {
  const apiKey = Deno.env.get("SUPPLIER_FAZERCARDS_API_KEY") || "";
  for (const delay of IMMEDIATE_POLL_DELAYS_MS) {
    await new Promise((r) => setTimeout(r, delay));

    const { data: tx } = await supabase
      .from("supplier_transactions")
      .select("id, supplier_reference, status")
      .eq("order_id", orderId)
      .eq("action", "create_order")
      .in("status", ["submitted", "pending"])
      .maybeSingle();
    if (!tx || !(tx as Record<string, any>).supplier_reference) return;

    const ref = (tx as Record<string, any>).supplier_reference as string;
    const polled = await fazercardsPollOrder(apiKey, ref);
    const polledAt = new Date().toISOString();

    if (polled.status === "completed") {
      await supabase.from("supplier_transactions").update({ status: "success", last_polled_at: polledAt }).eq("id", (tx as Record<string, any>).id);
      const { data: ord } = await supabase
        .from("orders")
        .select("id, fulfillment_status, payment_status")
        .eq("id", orderId)
        .maybeSingle();
      const o = (ord as Record<string, any>) || null;
      if (o && o.payment_status === "VERIFIED" && o.fulfillment_status === "PROCESSING") {
        const { error } = await supabase
          .from("orders")
          .update({ fulfillment_status: "COMPLETED", status: "COMPLETED", updated_at: polledAt })
          .eq("id", orderId)
          .eq("fulfillment_status", "PROCESSING");
        if (!error) {
          await supabase.from("order_timeline").insert({
            order_id: orderId,
            status: "COMPLETED",
            actor_email: "auto-reconciliation",
            note: `Supplier confirmed completion: ${ref}`,
          });
        }
      }
      return;
    }

    if (polled.status === "failed" && polled.failReason) {
      await supabase.from("supplier_transactions").update({ status: "failed", error_message: polled.failReason, last_polled_at: polledAt }).eq("id", (tx as Record<string, any>).id);
      const { data: ord } = await supabase
        .from("orders")
        .select("id, fulfillment_status, payment_status")
        .eq("id", orderId)
        .maybeSingle();
      const o = (ord as Record<string, any>) || null;
      if (o && o.payment_status === "VERIFIED" && o.fulfillment_status === "PROCESSING") {
        const { error } = await supabase
          .from("orders")
          .update({ fulfillment_status: "FAILED", status: "FULFILLMENT_FAILED", updated_at: polledAt })
          .eq("id", orderId)
          .eq("fulfillment_status", "PROCESSING");
        if (!error) {
          await supabase.from("order_timeline").insert({
            order_id: orderId,
            status: "FAILED",
            actor_email: "auto-reconciliation",
            note: `Supplier reported failure (${ref}): ${polled.failReason}`,
          });
          // Send fulfillment-failed email (fire-and-forget, duplicate-guarded).
          sendFulfillmentFailedEmail(supabase, orderId, `Supplier reported failure: ${polled.failReason}`).catch(() => {});
        }
      }
      return;
    }

    await supabase.from("supplier_transactions").update({ last_polled_at: polledAt }).eq("id", (tx as Record<string, any>).id);
  }
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
    const WEBHOOK_SECRET = Deno.env.get("PAYMENT_PAYMONGO_WEBHOOK_SECRET") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Service unavailable." }, 503);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const url = new URL(req.url);
    const providerParam = url.searchParams.get("provider") || "";
    const rawBody = await req.text();

    const { data: configs } = await supabase
      .from("payment_config")
      .select("*")
      .eq("provider_type", "automated")
      .eq("is_enabled", true);

    let matchedConfig: Record<string, any> | null = null;
    if (providerParam) {
      matchedConfig = (configs || []).find((c: Record<string, any>) => c.provider_name === providerParam) || null;
    }
    if (!matchedConfig && configs?.length) {
      matchedConfig = configs[0];
    }
    if (!matchedConfig) {
      return json({ received: true, message: "No matching provider config" });
    }
    if (matchedConfig.provider_name !== "paymongo") {
      return json({ received: true, message: "Unknown provider" });
    }

    const sigHeader = req.headers.get("paymongo-signature") || "";
    const result = await validatePayMongoWebhook(
      WEBHOOK_SECRET,
      Boolean(matchedConfig.is_test_mode),
      rawBody,
      sigHeader,
    );
    if (result.error) {
      return json({ error: result.error }, 400);
    }

    // Resolve the order: metadata order_id, else provider reference lookup,
    // else nested payment id (QR Ph Payment Intent flow).
    let orderId: string | null = result.orderId;
    if (!orderId && result.providerReference) {
      const { data: tx } = await supabase
        .from("payment_transactions")
        .select("order_id")
        .eq("provider_reference", result.providerReference)
        .limit(1)
        .maybeSingle();
      orderId = (tx as any)?.order_id || null;
    }
    if (!orderId) {
      const nested = (result.rawPayload as any)?.data?.attributes?.data?.attributes?.payments;
      const paymentId = Array.isArray(nested) && nested.length > 0 ? nested[0]?.id ?? null : null;
      if (paymentId) {
        const { data: tx } = await supabase
          .from("payment_transactions")
          .select("order_id")
          .eq("provider_payment_id", paymentId)
          .limit(1)
          .maybeSingle();
        orderId = (tx as any)?.order_id || null;
      }
    }
    if (!orderId) {
      return json({ received: true, message: "Order not found for webhook" });
    }

    // Idempotency: unique key on payment_transactions backs this up.
    const idempotencyKey = `webhook_${orderId}_${result.providerReference || "none"}_${result.status}`;
    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingTx) {
      return json({ received: true, message: "Already processed" });
    }

    // Log the webhook transaction.
    const webhookEventId = (result.rawPayload as any)?.data?.id || null;
    const { error: insertError } = await supabase.from("payment_transactions").insert({
      order_id: orderId,
      idempotency_key: idempotencyKey,
      provider_name: matchedConfig.provider_name,
      provider_reference: result.providerReference || null,
      action: "webhook",
      status: result.status === "PAID" ? "paid" : result.status === "FAILED" ? "failed" : result.status === "EXPIRED" ? "expired" : result.status === "REFUNDED" ? "refunded" : "processing",
      amount_cents: result.amountCents || 0,
      currency: matchedConfig.currency || "PHP",
      webhook_payload: result.rawPayload,
      webhook_event_id: webhookEventId,
    });
    if (insertError) {
      // Unique violation on concurrent duplicate = already processed.
      const msg = String((insertError as any).message || "");
      if (msg.includes("duplicate key") || msg.includes("unique")) {
        return json({ received: true, message: "Already processed" });
      }
      return json({ error: "Could not log webhook." }, 500);
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, status, total_cents")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) {
      return json({ received: true, message: "Order not found" });
    }

    const terminalStatuses = ["COMPLETED", "DELIVERED", "REFUNDED"];
    if (terminalStatuses.includes((order as any).status)) {
      return json({ received: true, message: "Order already in terminal state" });
    }

    const statusMap: Record<string, string> = {
      PAID: "PAID",
      SUCCESS: "PAID",
      PAID_SUCCESS: "PAID",
      FAILED: "CANCELLED",
      EXPIRED: "CANCELLED",
      REFUNDED: "REFUNDED",
      REFUND_COMPLETED: "REFUNDED",
      CANCELLED: "CANCELLED",
    };
    const targetStatus = statusMap[result.status] || null;
    if (!targetStatus) {
      return json({ received: true, message: `Unhandled status: ${result.status}` });
    }

    if (targetStatus === "PAID" && (order as any).status !== "WAITING_PAYMENT") {
      return json({ received: true, message: "Order not awaiting payment" });
    }

    if (targetStatus === "PAID") {
      // Amount check: the paid amount must match the order total exactly.
      if (result.amountCents != null && result.amountCents !== (order as any).total_cents) {
        return json({ received: true, message: `Amount mismatch: paid ${result.amountCents}, expected ${(order as any).total_cents}` }, 400);
      }

      // verify_payment is idempotent; service role passes the operator guard.
      const { error: verifyError } = await supabase.rpc("verify_payment", {
        p_order_id: orderId,
        p_verified_by: `webhook:${matchedConfig.provider_name}`,
        p_verification_method: "AUTOMATIC",
        p_payment_reference: result.providerReference || null,
        p_note: `Payment verified automatically via ${matchedConfig.provider_name}`,
      });
      if (verifyError) {
        return json({ error: "Fulfillment trigger failed" }, 500);
      }

      // Send payment-success email (fire-and-forget, duplicate-guarded by email_sent_log).
      sendPaymentSuccessEmail(supabase, orderId).catch(() => {});

      await triggerFulfillment(supabase, orderId);

      // Check fulfillment outcome — if it already failed synchronously, send the
      // fulfillment-failed email now. Poll-triggered failures send from the poll loop.
      const { data: postFulfill } = await supabase
        .from("orders")
        .select("fulfillment_status")
        .eq("id", orderId)
        .maybeSingle();
      if ((postFulfill as any)?.fulfillment_status === "FAILED") {
        sendFulfillmentFailedEmail(supabase, orderId, "Supplier fulfillment failed during initial attempt").catch(() => {});
      }

      // Fire-and-forget immediate polling so supplier completion propagates
      // within seconds instead of waiting for the 3-minute cron fallback.
      pollSupplierImmediately(supabase, orderId).catch(() => {});
    } else {
      const { error: rpcError } = await supabase.rpc("admin_change_order_status", {
        p_order_id: orderId,
        p_new_status: targetStatus,
        p_actor_email: `webhook:${matchedConfig.provider_name}`,
        p_note: `Payment ${result.status.toLowerCase()} via ${matchedConfig.provider_name}`,
      });
      if (rpcError) {
        return json({ error: "Status update failed" }, 500);
      }
    }

    return json({ received: true, status: targetStatus });
  } catch {
    return json({ received: true, error: "Webhook processing failed" }, 500);
  }
});

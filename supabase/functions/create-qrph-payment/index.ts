import { createClient } from "npm:@supabase/supabase-js@2";

/*
  Create a PayMongo QR Ph payment for an existing order.

  Runs inside the Edge Function runtime, which receives the managed secrets
  SUPABASE_SERVICE_ROLE_KEY and PAYMENT_PAYMONGO_SECRET_KEY. Secrets are only
  read into memory — never logged or returned.

  POST body: { orderReference, email, orderAccessToken }

  Flow:
  1. Find order by reference and verify its private order capability
  2. Find the paymongo_qrph payment config
  3. PayMongo: Payment Intent -> QR Ph Method -> Attach -> extract QR image URL
  4. Record the payment transaction and stamp the order
  5. Return the QR image URL and expiry to the checkout frontend
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

interface QrPhRequest {
  orderReference?: unknown;
  email?: unknown;
  orderAccessToken?: unknown;
}

interface QrPhResult {
  success: boolean;
  paymentIntentId: string | null;
  paymentMethodId: string | null;
  qrImageUrl: string | null;
  clientKey: string | null;
  expiresAt: string | null;
  error: string | null;
  rawResponse: unknown;
}

interface OrderRow {
  id: string;
  reference: string;
  email: string;
  status: string;
  total_cents: number;
}

async function paymongoJson(
  secretKey: string,
  url: string,
  payload: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const auth = "Basic " + btoa(secretKey + ":");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: (data ?? {}) as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

function errorDetail(data: Record<string, unknown>): string {
  const errors = data.errors as Array<{ detail?: string; code?: string }> | undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] ?? {};
    return String(first.detail || first.code || JSON.stringify(errors));
  }
  const message = (data as { message?: unknown }).message;
  return message ? String(message) : "Payment provider error";
}

async function createQrPhPayment(
  secretKey: string,
  baseUrl: string,
  opts: {
    order: OrderRow;
    currency: string;
    redirectUrl: string;
    metadata: Record<string, unknown>;
  },
): Promise<QrPhResult> {
  const { order, currency, redirectUrl, metadata } = opts;

  // Step 1: Create a Payment Intent with qrph allowed
  const intentRes = await paymongoJson(secretKey, `${baseUrl}/payment_intents`, {
    data: {
      attributes: {
        amount: order.total_cents,
        currency,
        description: `RunFaZone Order ${order.reference}`,
        statement_descriptor: order.reference.slice(0, 22),
        payment_method_allowed: ["qrph"],
        capture_type: "automatic",
        metadata,
      },
    },
  });
  if (!intentRes.ok) {
    return fail(null, null, null, errorDetail(intentRes.data), intentRes.data);
  }
  const intentData = intentRes.data.data as
    | { id?: string; attributes?: { client_key?: string } }
    | undefined;
  const intentId = intentData?.id ?? null;
  const clientKey = intentData?.attributes?.client_key ?? null;
  if (!intentId || !clientKey) {
    return fail(null, null, null, "Malformed Payment Intent response", intentRes.data);
  }

  // Step 2: Create a QR Ph Payment Method
  const methodRes = await paymongoJson(secretKey, `${baseUrl}/payment_methods`, {
    data: { attributes: { type: "qrph", metadata } },
  });
  if (!methodRes.ok) {
    return fail(intentId, null, clientKey, errorDetail(methodRes.data), methodRes.data);
  }
  const methodData = methodRes.data.data as { id?: string } | undefined;
  const paymentMethodId = methodData?.id ?? null;
  if (!paymentMethodId) {
    return fail(intentId, null, clientKey, "Malformed Payment Method response", methodRes.data);
  }

  // Step 3: Attach the Payment Method to the Payment Intent
  const attachRes = await paymongoJson(
    secretKey,
    `${baseUrl}/payment_intents/${intentId}/attach`,
    {
      data: {
        attributes: {
          payment_method: paymentMethodId,
          client_key: clientKey,
          return_url: redirectUrl || undefined,
        },
      },
    },
  );
  if (!attachRes.ok) {
    return fail(intentId, paymentMethodId, clientKey, errorDetail(attachRes.data), attachRes.data);
  }

  // Step 4: Extract the QR image URL from next_action
  const attachData = attachRes.data.data as
    | { attributes?: { next_action?: { code?: { image_url?: string } } } }
    | undefined;
  const qrImageUrl = attachData?.attributes?.next_action?.code?.image_url ?? null;
  if (!qrImageUrl) {
    return fail(
      intentId,
      paymentMethodId,
      clientKey,
      "No QR image URL returned by PayMongo",
      attachRes.data,
    );
  }

  // QR Ph payments expire in 30 minutes by default
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return {
    success: true,
    paymentIntentId: intentId,
    paymentMethodId,
    qrImageUrl,
    clientKey,
    expiresAt,
    error: null,
    rawResponse: attachRes.data,
  };
}

function fail(
  paymentIntentId: string | null,
  paymentMethodId: string | null,
  clientKey: string | null,
  error: string,
  rawResponse: unknown,
): QrPhResult {
  return {
    success: false,
    paymentIntentId,
    paymentMethodId,
    qrImageUrl: null,
    clientKey,
    expiresAt: null,
    error,
    rawResponse,
  };
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
    const PAYMONGO_SECRET = Deno.env.get("PAYMENT_PAYMONGO_SECRET_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY || !PAYMONGO_SECRET) {
      return json({ error: "Service unavailable." }, 503);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json().catch(() => null)) as QrPhRequest | null;
    const orderReference =
      typeof body?.orderReference === "string" ? body.orderReference.toUpperCase().trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const orderAccessToken = typeof body?.orderAccessToken === "string" ? body.orderAccessToken : "";
    if (!orderReference || !email || !/^[A-Za-z0-9_-]{40,64}$/.test(orderAccessToken)) {
      return json({ error: "Order reference and email are required." }, 400);
    }

    const { data: order } = await supabase
      .from("orders")
      .select("id, reference, email, status, total_cents, customer_user_id")
      .eq("reference", orderReference)
      .maybeSingle();
    if (!order || order.email.trim().toLowerCase() !== email.toLowerCase()) {
      return json({ error: "Order not found." }, 404);
    }

    const capabilityDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(orderAccessToken),
    );
    const capabilityHash = Array.from(new Uint8Array(capabilityDigest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { data: capability } = await supabase
      .from("guest_order_access")
      .select("order_id")
      .eq("order_id", order.id)
      .eq("token_hash", capabilityHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!capability) return json({ error: "Order not found." }, 404);
    if (order.status !== "WAITING_PAYMENT") {
      if (["PAID", "PROCESSING", "COMPLETED"].includes(order.status)) {
        return json({ success: true, alreadyPaid: true });
      }
      return json({ error: "Order is not awaiting payment." }, 400);
    }

    // Idempotency: reuse an existing pending QR Ph payment with a valid QR image
    const idempotencyKey = `qrph_${order.id}`;
    const { data: existingTx } = await supabase
      .from("payment_transactions")
      .select("status, qr_image_url, provider_reference, expires_at")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingTx?.status === "paid") {
      return json({ success: true, alreadyPaid: true });
    }

    if (existingTx?.qr_image_url && ["pending", "processing"].includes(existingTx.status)) {
      const expiresAt = existingTx.expires_at ? new Date(existingTx.expires_at) : null;
      if (expiresAt && expiresAt > new Date()) {
        return json({
          success: true,
          qrImageUrl: existingTx.qr_image_url,
          paymentIntentId: existingTx.provider_reference,
          expiresAt: existingTx.expires_at,
          amountCents: order.total_cents,
          message: "Existing QR Ph payment session found.",
        });
      }
    }

    const { data: config } = await supabase
      .from("payment_config")
      .select("provider_name, api_url, is_test_mode, currency, webhook_url")
      .eq("method_key", "paymongo_qrph")
      .eq("is_enabled", true)
      .eq("provider_type", "automated")
      .maybeSingle();
    if (!config || config.provider_name !== "paymongo") {
      return json({ error: "QR Ph payment is not configured or enabled." }, 400);
    }

    const baseUrl = (config.api_url || "").trim() || "https://api.paymongo.com/v1";
    const currency = config.currency || "PHP";

    const metadata = { order_id: order.id, order_reference: order.reference };
    const result = await createQrPhPayment(PAYMONGO_SECRET, baseUrl, {
      order,
      currency,
      redirectUrl: "",
      metadata,
    });

    // Upsert on the unique idempotency key: replaces an expired session row in
    // place, and makes concurrent duplicate creations converge on one row
    // instead of failing the UNIQUE constraint.
    const { error: txError } = await supabase.from("payment_transactions").upsert(
      {
        order_id: order.id,
        idempotency_key: idempotencyKey,
        provider_name: config.provider_name,
        provider_reference: result.paymentIntentId || null,
        provider_payment_id: result.paymentMethodId || null,
        action: "create",
        status: result.success ? "pending" : "failed",
        amount_cents: order.total_cents,
        currency,
        qr_image_url: result.qrImageUrl || null,
        expires_at: result.expiresAt || null,
        error_message: result.error || null,
        metadata: { raw_response: result.rawResponse, client_key: result.clientKey },
      },
      { onConflict: "idempotency_key" },
    );
    if (txError) {
      return json({ error: "Could not record the payment session." }, 500);
    }

    if (!result.success) {
      return json({ error: result.error || "QR Ph payment creation failed." }, 500);
    }

    // Stamp the order with provider info
    await supabase
      .from("orders")
      .update({
        payment_provider: config.provider_name,
        payment_mode: "automated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    return json({
      success: true,
      qrImageUrl: result.qrImageUrl,
      paymentIntentId: result.paymentIntentId,
      expiresAt: result.expiresAt,
      amountCents: order.total_cents,
    });
  } catch {
    return json({ error: "Something went wrong." }, 500);
  }
});

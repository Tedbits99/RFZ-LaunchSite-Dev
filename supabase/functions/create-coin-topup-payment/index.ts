import { createClient } from "npm:@supabase/supabase-js@2";
import { isSafeRfCoinPaymongoSandbox } from "../_shared/rfCoinPaymongoSafety.ts";

/*
  Create a PayMongo QR Ph payment for an RF Coins top-up.

  Runs inside the Edge Function runtime, which receives the managed secrets
  SUPABASE_SERVICE_ROLE_KEY and PAYMENT_PAYMONGO_SECRET_KEY. Secrets are only
  read into memory — never logged or returned.

  POST body: { packageId, userId }
  Authorization: Bearer <customer access token> (anon apikey header also set)

  Flow:
  1. Verify the caller's JWT resolves to the requested user (fail closed)
  2. rf_coin_create_topup RPC — run on a client built from the CALLER's JWT
     (anon key + Bearer), NOT the service role: the SQL function verifies
     p_user_id against auth.uid(), which is only present for the real
     customer. The service role has no auth.uid() and would be rejected.
  3. PayMongo: Payment Intent -> QR Ph Method -> Attach -> extract QR image URL
  4. Reserve the payment transaction with the payment_transactions schema
     (provider_name, action, status) before contacting PayMongo. A provider
     request must never proceed without a durable idempotency record.
  5. Return QR image URL + expiry to the wallet frontend

  Crediting happens ONLY via rf_coin_credit_paid_topup, called by the payment
  webhook after signature-verified provider confirmation.
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// This legacy PayMongo wallet-funding path is release-locked. Product
// checkout uses a separate endpoint and is not affected. Do not enable this
// path until the approved wallet funding architecture and hosted financial
// acceptance gates are complete.
const RF_COINS_FUNDING_RELEASE_ENABLED = false;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface TopupRequest {
  packageId?: unknown;
  userId?: unknown;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    if (!RF_COINS_FUNDING_RELEASE_ENABLED) {
      return json({ error: "RF Coins funding is not available yet." }, 503);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const PAYMONGO_SECRET = Deno.env.get("PAYMENT_PAYMONGO_SECRET_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY || !PAYMONGO_SECRET) {
      return json({ error: "Service unavailable." }, 503);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- Caller identity: fail closed unless a verified JWT matches userId ---
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    if (!bearer || bearer === SERVICE_KEY) {
      return json({ error: "Sign in required." }, 401);
    }
    const authClient = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: authData } = await authClient.auth.getUser(bearer);
    const caller = authData?.user;
    if (!caller || !caller.email_confirmed_at) {
      return json({ error: "Sign in required." }, 401);
    }

    // JWT-scoped client: rpc rf_coin_create_topup runs with the customer as
    // auth.uid() so its internal p_user_id <> auth.uid() check passes.
    const jwtClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });

    const body = (await req.json().catch(() => null)) as TopupRequest | null;
    const packageId = typeof body?.packageId === "string" ? body.packageId.trim() : "";
    const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
    if (!packageId || userId !== caller.id) {
      return json({ error: "Invalid top-up request." }, 400);
    }

    // Profile must be active (defense in depth; the wallet page also checks).
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("status")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!profile || profile.status !== "active") {
      return json({ error: "Account not eligible." }, 403);
    }

    // This funding feature remains sandbox-only until the hosted RF Coins
    // schema, webhook reconciliation, ledger, and E2E acceptance gates pass.
    // Check before creating a top-up record so a misconfigured/live provider
    // cannot leave pending wallet-funding rows behind.
    const { data: config, error: configError } = await supabase
      .from("payment_config")
      .select("provider_type, provider_name, api_url, is_enabled, is_test_mode, currency, webhook_url")
      .eq("method_key", "paymongo_qrph")
      .eq("is_enabled", true)
      .eq("provider_type", "automated")
      .maybeSingle();
    if (configError || !config || !isSafeRfCoinPaymongoSandbox({
      providerName: config?.provider_name,
      providerType: config?.provider_type,
      enabled: config?.is_enabled,
      testMode: config?.is_test_mode,
      secretKey: PAYMONGO_SECRET,
      apiUrl: config?.api_url,
    })) {
      return json({ error: "RF Coins payments are unavailable until sandbox funding is verified." }, 503);
    }
    const currency = String(config.currency || "PHP");
    const normalizedCurrency = currency.toUpperCase();

    // --- Create the top-up (validates RF Coins settings + active package) ---
    const { data: rpcData, error: rpcError } = await jwtClient.rpc("rf_coin_create_topup", {
      p_user_id: caller.id,
      p_package_id: packageId,
    });
    if (rpcError) {
      return json({ error: "Could not start this top-up." }, 500);
    }
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (!row?.out_topup_id || row.out_error) {
      const code = String(row?.out_error || "RF_COIN_DISABLED");
      const friendly: Record<string, string> = {
        RF_COIN_DISABLED: "RF Coins is not available right now.",
        RF_COIN_TOPUPS_DISABLED: "Buying RF Coins is temporarily unavailable.",
        RF_COIN_PACKAGE_UNAVAILABLE: "That coin package is no longer available.",
        RF_COIN_FORBIDDEN: "You are not allowed to perform this action.",
      };
      return json({ error: friendly[code] || "Could not start this top-up." }, 400);
    }

    const topupId = String(row.out_topup_id);
    const priceCents = Number(row.out_price_cents);
    const idempotencyKey = `rfcoin_topup_${topupId}`;

    // The SQL RPC reuses one pending top-up per customer/package. Reuse its
    // recorded QR session too; never create another provider intent on retry.
    const { data: topup, error: topupError } = await supabase
      .from("rf_coin_topups")
      .select("status, provider_reference")
      .eq("id", topupId)
      .maybeSingle();
    if (topupError || !topup) return json({ error: "Could not verify the top-up state." }, 503);
    if (topup.status === "PAID") {
      return json({ success: true, alreadyPaid: true }, 200);
    }
    if (topup.status !== "PENDING") {
      return json({ error: "This top-up attempt is no longer pending. Start a new purchase." }, 409);
    }

    const { data: existingSession, error: existingSessionError } = await supabase
      .from("payment_transactions")
      .select("status, amount_cents, currency, provider_reference, qr_image_url, expires_at")
      .eq("rf_coin_topup_id", topupId)
      .eq("provider_name", "paymongo")
      .eq("action", "create")
      .maybeSingle();
    if (existingSessionError) return json({ error: "Could not verify the payment session." }, 503);
    if (existingSession) {
      const expiresAt = existingSession.expires_at ? new Date(existingSession.expires_at) : null;
      if (
        existingSession.status === "pending" &&
        existingSession.amount_cents === priceCents &&
        String(existingSession.currency || "").toUpperCase() === normalizedCurrency &&
        existingSession.qr_image_url && expiresAt && expiresAt > new Date()
      ) {
        return json({
          success: true,
          topupId,
          qrImageUrl: existingSession.qr_image_url,
          paymentIntentId: existingSession.provider_reference,
          expiresAt: existingSession.expires_at,
          amountCents: existingSession.amount_cents,
        }, 200);
      }
      if (existingSession.status === "pending" && expiresAt && expiresAt <= new Date()) {
        const { data: expired, error: expireError } = await supabase.rpc("rf_coin_mark_topup_status", {
          p_topup_id: topupId,
          p_status: "EXPIRED",
          p_provider_reference: existingSession.provider_reference,
        });
        const expiredRow = Array.isArray(expired) ? expired[0] : expired;
        if (expireError || !expiredRow?.out_ok || expiredRow?.out_error) {
          return json({ error: "The expired payment session could not be safely closed." }, 500);
        }
        return json({ error: "This QR payment expired. Please start a new purchase." }, 409);
      }
      // A reservation or incomplete session may represent an external intent.
      // Do not create a second intent until the first attempt is reconciled.
      return json({ error: "A payment attempt is already being processed. Please retry shortly; do not start another payment." }, 409);
    }
    if (topup.provider_reference) {
      return json({ error: "An existing provider payment is awaiting reconciliation." }, 409);
    }

    const cfg = config as Record<string, unknown>;
    const baseUrl = String(cfg.api_url || "https://api.paymongo.com/v1");
    const webhookUrl = typeof cfg.webhook_url === "string" ? cfg.webhook_url : "";
    if (webhookUrl && !webhookUrl.includes("/functions/v1/payment-webhook")) {
      return json({ error: "QR Ph payment is not configured or enabled." }, 400);
    }

    // Claim the unique attempt before any provider request. Concurrent retries
    // collide on idempotency_key and the losing request never contacts PayMongo.
    const { error: reservationError } = await supabase.from("payment_transactions").insert({
      rf_coin_topup_id: topupId,
      idempotency_key: idempotencyKey,
      provider_name: "paymongo",
      action: "create",
      amount_cents: priceCents,
      currency,
      status: "processing",
      metadata: { method_key: "paymongo_qrph", purpose: "rf_coin_topup", reservation: true },
    });
    if (reservationError) {
      const { data: racedSession } = await supabase
        .from("payment_transactions")
        .select("status, amount_cents, currency, provider_reference, qr_image_url, expires_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      const expiresAt = racedSession?.expires_at ? new Date(racedSession.expires_at) : null;
      if (
        racedSession?.status === "pending" &&
        racedSession.amount_cents === priceCents &&
        String(racedSession.currency || "").toUpperCase() === normalizedCurrency &&
        racedSession.qr_image_url && expiresAt && expiresAt > new Date()
      ) {
        return json({
          success: true,
          topupId,
          qrImageUrl: racedSession.qr_image_url,
          paymentIntentId: racedSession.provider_reference,
          expiresAt: racedSession.expires_at,
          amountCents: racedSession.amount_cents,
        }, 200);
      }
      return json({ error: "A payment attempt is already being processed. Please retry shortly; do not start another payment." }, 409);
    }

    const closeFailedAttempt = async (providerReference: string | null, message: string): Promise<boolean> => {
      if (providerReference) {
        const { error: topupUpdateError } = await supabase
          .from("rf_coin_topups")
          .update({ provider_reference: providerReference })
          .eq("id", topupId)
          .eq("status", "PENDING");
        if (topupUpdateError) return false;
      }
      const { error: txUpdateError } = await supabase
        .from("payment_transactions")
        .update({ status: "failed", provider_reference: providerReference, error_message: message })
        .eq("idempotency_key", idempotencyKey)
        .eq("status", "processing");
      if (txUpdateError) return false;
      const { data: statusData, error: statusError } = await supabase.rpc("rf_coin_mark_topup_status", {
        p_topup_id: topupId,
        p_status: "FAILED",
        p_provider_reference: providerReference,
      });
      const statusRow = Array.isArray(statusData) ? statusData[0] : statusData;
      return !statusError && Boolean(statusRow?.out_ok) && !statusRow?.out_error;
    };

    // --- PayMongo: intent -> qrph method -> attach -> QR image URL ---
    const metadata = {
      rf_coin_topup_id: topupId,
      rf_coin_user_id: caller.id,
      purpose: "rf_coin_topup",
    };
    const intentRes = await paymongoJson(PAYMONGO_SECRET, `${baseUrl}/payment_intents`, {
      data: {
        attributes: {
          amount: priceCents,
          currency,
          description: `RunFazone RF Coins ${topupId.slice(0, 8)}`,
          statement_descriptor: "RUNFAZONE RF COINS".slice(0, 22),
          payment_method_allowed: ["qrph"],
          capture_type: "automatic",
          metadata,
        },
      },
    });
    if (!intentRes.ok) {
      const closed = await closeFailedAttempt(null, "Payment intent creation failed.");
      return json({ error: closed ? errorDetail(intentRes.data) : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }
    const intentData = intentRes.data.data as
      | { id?: string; attributes?: { client_key?: string } }
      | undefined;
    const intentId = intentData?.id ?? null;
    const clientKey = intentData?.attributes?.client_key ?? null;
    if (!intentId || !clientKey) {
      const closed = await closeFailedAttempt(intentId, "Payment intent response was incomplete.");
      return json({ error: closed ? "Malformed payment response." : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }

    const methodRes = await paymongoJson(PAYMONGO_SECRET, `${baseUrl}/payment_methods`, {
      data: { attributes: { type: "qrph", metadata } },
    });
    if (!methodRes.ok) {
      const closed = await closeFailedAttempt(intentId, "QR payment method creation failed.");
      return json({ error: closed ? errorDetail(methodRes.data) : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }
    const methodData = methodRes.data.data as { id?: string } | undefined;
    const paymentMethodId = methodData?.id ?? null;
    if (!paymentMethodId) {
      const closed = await closeFailedAttempt(intentId, "QR payment method response was incomplete.");
      return json({ error: closed ? "Malformed payment response." : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }

    const attachRes = await paymongoJson(
      PAYMONGO_SECRET,
      `${baseUrl}/payment_intents/${intentId}/attach`,
      {
        data: {
          attributes: {
            payment_method: paymentMethodId,
            client_key: clientKey,
            return_url: `${Deno.env.get("NEXT_PUBLIC_APP_URL") || ""}/account/wallet`,
          },
        },
      },
    );
    if (!attachRes.ok) {
      const closed = await closeFailedAttempt(intentId, "QR payment attachment failed.");
      return json({ error: closed ? errorDetail(attachRes.data) : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }
    const attachData = attachRes.data.data as
      | { attributes?: { next_action?: { code?: { image_url?: string } } } }
      | undefined;
    const qrImageUrl = attachData?.attributes?.next_action?.code?.image_url ?? null;
    if (!qrImageUrl) {
      const closed = await closeFailedAttempt(intentId, "Payment provider returned no QR image.");
      return json({ error: closed ? "No QR image returned by PayMongo." : "Payment attempt could not be safely closed." }, closed ? 502 : 500);
    }

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Stamp the top-up with the provider reference.
    const { error: topupReferenceError } = await supabase
      .from("rf_coin_topups")
      .update({ provider_reference: intentId })
      .eq("id", topupId)
      .eq("status", "PENDING");
    if (topupReferenceError) {
      return json({ error: "Could not safely record the payment reference. Do not retry this payment; contact support." }, 500);
    }

    const { data: savedSession, error: txUpdateError } = await supabase
      .from("payment_transactions")
      .update({
        status: "pending",
        provider_reference: intentId,
        qr_image_url: qrImageUrl,
        expires_at: expiresAt,
        metadata: { method_key: "paymongo_qrph", purpose: "rf_coin_topup" },
      })
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (txUpdateError || !savedSession) {
      return json({ error: "Could not safely record the payment session. Do not retry this payment; contact support." }, 500);
    }

    return json({
      success: true,
      topupId,
      qrImageUrl,
      paymentIntentId: intentId,
      clientKey,
      expiresAt,
      amountCents: priceCents,
    }, 200);
  } catch {
    // Do not log provider/Supabase exception objects: they can contain request
    // details. An interrupted provider request leaves its durable reservation
    // in `processing`, which intentionally blocks a duplicate payment attempt
    // until it can be reconciled safely.
    console.error("create-coin-topup-payment: request failed; details redacted");
    return json({ error: "Payment setup could not be confirmed. Please contact support before retrying." }, 503);
  }
});

import { createClient } from "npm:@supabase/supabase-js@2";

/*
  Create a PayMongo QR Ph payment for an RF Coins top-up.

  Runs inside the Edge Function runtime, which receives the managed secrets
  SUPABASE_SERVICE_ROLE_KEY and PAYMENT_PAYMONGO_SECRET_KEY. Secrets are only
  read into memory — never logged or returned.

  POST body: { packageId, userId }
  Authorization: Bearer <customer access token> (anon apikey header also set)

  Flow:
  1. Verify the caller's JWT resolves to the requested user (fail closed)
  2. rf_coin_create_topup RPC (validates settings + package, snapshots price)
  3. PayMongo: Payment Intent -> QR Ph Method -> Attach -> extract QR image URL
  4. Return QR image URL + expiry to the wallet frontend

  Crediting happens ONLY via rf_coin_credit_paid_topup, called by the payment
  webhook after signature-verified provider confirmation.
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

interface TopupRequest {
  packageId?: unknown;
  userId?: unknown;
}

interface QrPhResult {
  success: boolean;
  paymentIntentId: string | null;
  qrImageUrl: string | null;
  clientKey: string | null;
  expiresAt: string | null;
  error: string | null;
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PAYMONGO_SECRET = Deno.env.get("PAYMENT_PAYMONGO_SECRET_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY || !PAYMONGO_SECRET) {
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

    // --- Create the top-up (validates RF Coins settings + active package) ---
    const { data: rpcData, error: rpcError } = await supabase.rpc("rf_coin_create_topup", {
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

    // --- Reuse an existing pending payment session when present ---
    const { data: existing } = await supabase
      .from("rf_coin_topups")
      .select("status, provider_reference")
      .eq("id", topupId)
      .maybeSingle();
    if ((existing as Record<string, unknown> | null)?.status === "PAID") {
      return json({ success: true, alreadyPaid: true }, 200);
    }

    const { data: config } = await supabase
      .from("payment_config")
      .select("provider_name, api_url, is_test_mode, currency, webhook_url")
      .eq("method_key", "paymongo_qrph")
      .eq("is_enabled", true)
      .eq("provider_type", "automated")
      .maybeSingle();
    if (!config || (config as Record<string, unknown>).provider_name !== "paymongo") {
      return json({ error: "QR Ph payment is not configured or enabled." }, 400);
    }
    const cfg = config as Record<string, unknown>;
    const baseUrl = String(cfg.api_url || "https://api.paymongo.com/v1");
    const currency = String(cfg.currency || "PHP");
    const webhookUrl = typeof cfg.webhook_url === "string" ? cfg.webhook_url : "";
    if (webhookUrl && !webhookUrl.includes("/functions/v1/payment-webhook")) {
      return json({ error: "QR Ph payment is not configured or enabled." }, 400);
    }

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
    if (!intentRes.ok) return json({ error: errorDetail(intentRes.data) }, 502);
    const intentData = intentRes.data.data as
      | { id?: string; attributes?: { client_key?: string } }
      | undefined;
    const intentId = intentData?.id ?? null;
    const clientKey = intentData?.attributes?.client_key ?? null;
    if (!intentId || !clientKey) return json({ error: "Malformed payment response." }, 502);

    const methodRes = await paymongoJson(PAYMONGO_SECRET, `${baseUrl}/payment_methods`, {
      data: { attributes: { type: "qrph", metadata } },
    });
    if (!methodRes.ok) return json({ error: errorDetail(methodRes.data) }, 502);
    const methodData = methodRes.data.data as { id?: string } | undefined;
    const paymentMethodId = methodData?.id ?? null;
    if (!paymentMethodId) return json({ error: "Malformed payment response." }, 502);

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
    if (!attachRes.ok) return json({ error: errorDetail(attachRes.data) }, 502);
    const attachData = attachRes.data.data as
      | { attributes?: { next_action?: { code?: { image_url?: string } } } }
      | undefined;
    const qrImageUrl = attachData?.attributes?.next_action?.code?.image_url ?? null;
    if (!qrImageUrl) return json({ error: "No QR image returned by PayMongo." }, 502);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // --- Record the payment transaction (service role; no QR image reuse) ---
    await supabase.from("payment_transactions").insert({
      rf_coin_topup_id: topupId,
      idempotency_key: idempotencyKey,
      provider: "paymongo",
      method_key: "paymongo_qrph",
      amount_cents: priceCents,
      status: "pending",
      provider_reference: intentId,
      expires_at: expiresAt,
    });

    // Stamp the top-up with the provider reference.
    await supabase
      .from("rf_coin_topups")
      .update({ provider_reference: intentId })
      .eq("id", topupId);

    return json({
      success: true,
      topupId,
      qrImageUrl,
      paymentIntentId: intentId,
      clientKey,
      expiresAt,
      amountCents: priceCents,
    }, 200);
  } catch (err) {
    console.error("create-coin-topup-payment error", err);
    return json({ error: "Something went wrong." }, 500);
  }
});

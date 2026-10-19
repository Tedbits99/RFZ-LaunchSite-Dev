import { createClient } from "npm:@supabase/supabase-js@2";
import {
  processFulfillmentHandoffBatch,
  getFulfillmentHandoffSecret,
  isAuthorizedFulfillmentHandoffRequest,
  json,
  corsHeaders,
} from "../_shared/fulfillmentHandoffWorker.ts";

/*
  Durable fulfillment handoff worker for RF Coins orders (v2 fallback route).

  Identical logic to fulfillment-handoff; exists because the platform router
  never registered the original slug despite successful deployments.

  A coin-paid order enqueues exactly one rf_coin_fulfillment_handoffs row at
  checkout. This scheduled worker claims lease-bound rows via
  rf_coin_claim_fulfillment_handoffs and drives the SAME fulfillment pipeline
  the PayMongo webhook and admin paths use: the atomic complete_fulfillment
  claim (NOT_STARTED -> PROCESSING, FOR UPDATE) plus the supplier transaction
  idempotency keys. Fulfillment survives checkout request termination; a
  crashed worker's lease expires and the row is retried with backoff.

  The cron trigger sends X-Cron-Secret read from _cron_secrets; this worker
  validates it with the same constant-time comparison as auto-reconciliation.

  This worker NEVER creates supplier orders on its own beyond what the
  canonical fulfillment pipeline does; it only invokes the pipeline for
  claimed handoffs whose payment is verified. Nothing here disables or
  bypasses any existing safety check.

  Worker logic lives in _shared/fulfillmentHandoffWorker.ts so the identical
  logic can also be served from an alternate route inside auto-reconciliation.
*/

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
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Service unavailable." }, 503);
    }

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const configuredSecret = await getFulfillmentHandoffSecret(db);
    if (!configuredSecret) {
      return json({ error: "Service unavailable." }, 503);
    }
    if (!isAuthorizedFulfillmentHandoffRequest(req.headers.get("X-Cron-Secret"), configuredSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }

    // Health check: authenticated probe of route + auth wiring. Runs before
    // any queue claim and touches no supplier, order, wallet or payment data.
    const url = new URL(req.url);
    if (url.searchParams.get("health") === "1") {
      return json({ ok: true, worker: "fulfillment-handoff-v2", claimed: 0 });
    }

    return await processFulfillmentHandoffBatch(db);
  } catch {
    return json({ error: "Fulfillment handoff processing failed" }, 500);
  }
});

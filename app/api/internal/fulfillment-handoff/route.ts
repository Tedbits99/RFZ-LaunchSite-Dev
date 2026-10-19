import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import {
  getFulfillmentHandoffSecret,
  isAuthorizedFulfillmentHandoffRequest,
  processFulfillmentHandoffBatch,
  BatchResult,
} from '@/lib/fulfillmentHandoffBatch';

/*
  Protected internal fulfillment-handoff worker for the RF Coins queue.

  Called only by the existing pg_cron job 4 via pg_net with the existing
  fulfillment_handoff_secret in the X-Cron-Secret header (read from the
  existing _cron_secrets store). Replaces the unreachable Edge Function
  dispatch route; the Edge Functions, cron jobs, and queue RPCs themselves
  are unchanged.

  POST ?health=1  -> authenticated zero-side-effect probe (no queue claims,
                     no supplier calls, no order/payment/wallet writes).
  POST            -> claim up to one lease-bound queue row and run the
                     canonical fulfillment pipeline (FazerCards only).

  Fails closed on missing configuration. Never exposes the secret or
  service-role credentials in any response.
*/

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unavailable() {
  return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  if (!adminSupabase) return unavailable();

  const configuredSecret = await getFulfillmentHandoffSecret(adminSupabase);
  if (!configuredSecret) return unavailable();

  const providedSecret = req.headers.get('X-Cron-Secret');
  if (!isAuthorizedFulfillmentHandoffRequest(providedSecret, configuredSecret)) {
    return unauthorized();
  }

  const health = new URL(req.url).searchParams.get('health') === '1';
  if (health) {
    return NextResponse.json({ ok: true, worker: 'nextjs:internal-fulfillment-handoff', claimed: 0 });
  }

  try {
    const result: BatchResult = await processFulfillmentHandoffBatch(adminSupabase);
    return NextResponse.json(result);
  } catch {
    // Internal error details (DB messages, stack traces) must never reach the
    // response body. The queue's lease expires and the row is retried or
    // dead-lettered by the existing ack/lease machinery, so no state is lost.
    return NextResponse.json({ error: 'Fulfillment batch failed.' }, { status: 500 });
  }
}

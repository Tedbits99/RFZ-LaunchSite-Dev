import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { hashOrderCapability, orderCapabilityCookieName } from '@/lib/orderCapability';
import { RF_COIN_PAYMENT_METHOD, rfCoinErrorMessage } from '@/lib/rfCoins';

/*
  Order creation with RF Coins wallet payment (Phase 3, gated by the master
  flag rf_coin_settings.enabled). Runs entirely server-side:

  1. Verified customer session required (rfz-customer-auth namespace)
  2. create_order RPC on the customer-JWT client (same as normal checkout;
     the browser price is never trusted). The ownership trigger derives
     customer_user_id from the JWT and creates the capability record itself.
  3. rf_coin_settle_order_payment_and_enqueue on the SAME client: computes
     coins from the order's own total_cents, locks the wallet row, debits
     exactly once, and enqueues the durable fulfillment handoff in the SAME
     database transaction — a crash after settlement can never leave a paid
     order without queued fulfillment.
  4. On settlement failure the just-created order is marked CANCELLED by the
     service-role client and the coins stay untouched (release-on-failure).
*/

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Checkout is not configured. Please contact support.' }, { status: 503 });
  }

  // Coin payment requires a verified customer session - no guest path.
  const hasCustomerAuthCookie = req.cookies.getAll().some(({ name }) =>
    /^rfz-customer-auth(?:\.\d+)?$/.test(name));
  if (!hasCustomerAuthCookie) {
    return NextResponse.json({ error: 'Paying with RF Coins requires a signed-in account.' }, { status: 401 });
  }
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Checkout is not configured. Please contact support.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { gameId, packageId, name, playerInputs, voucherCode } = body;
    const customerClient = createCustomerServerClient();
    let user: { id: string; email: string | null };

    try {
      const { data, error } = await customerClient.auth.getUser();
      if (error || !data.user) {
        return NextResponse.json({ error: 'Your session could not be verified.' }, { status: 401 });
      }
      if (!data.user.email_confirmed_at) {
        return NextResponse.json({ error: 'Please verify your email before checking out.' }, { status: 403 });
      }
      const { data: profile, error: profileError } = await customerClient
        .from('customer_profiles')
        .select('status')
        .eq('user_id', data.user.id)
        .maybeSingle();
      if (profileError || !profile || profile.status !== 'active') {
        return NextResponse.json({ error: 'Your account is not eligible for checkout.' }, { status: 403 });
      }
      user = { id: data.user.id, email: data.user.email || null };
    } catch {
      return NextResponse.json({ error: 'Your session could not be verified.' }, { status: 401 });
    }

    // Gate the whole flow on the RF Coins master switch (fail closed).
    // rf_coin_settings has NO client policy (fail-closed RLS), so the
    // customer-JWT read would be denied; the authoritative read is server-side
    // via the service-role client. Spending additionally requires the
    // rf_coin_wallet payment method to be enabled in payment_config, which
    // create_order validates independently.
    const { data: settings, error: settingsError } = await adminSupabase!
      .from('rf_coin_settings')
      .select('enabled, spending_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (settingsError || !adminSupabase || !settings || !settings.enabled || !settings.spending_enabled) {
      return NextResponse.json({ error: 'Paying with RF Coins is not available.' }, { status: 403 });
    }

    // The capability hash rides in player_inputs; the ownership trigger stores
    // it in guest_order_access and strips it from the visible JSON.
    const capability = randomBytes(32).toString('base64url');

    const { data, error } = await customerClient.rpc('create_order', {
      p_game_id: gameId,
      p_package_id: packageId,
      p_email: user.email || '',
      p_customer_name: name || 'RunFazone Customer',
      p_player_inputs: {
        ...(playerInputs && typeof playerInputs === 'object' && !Array.isArray(playerInputs)
          ? playerInputs as Record<string, unknown>
          : {}),
        __rfz_order_access_hash: hashOrderCapability(capability),
      },
      p_payment_method: RF_COIN_PAYMENT_METHOD,
      p_voucher_code: (voucherCode || '').trim().toUpperCase() || null,
      p_voucher_email: user.email || '',
    });

    if (error) {
      if (error.message.includes('CHECKOUT_POLICY_UNAVAILABLE')) {
        return NextResponse.json({ error: 'Checkout is temporarily unavailable. Please try again later.' }, { status: 503 });
      }
      if (error.message.includes('EMAIL_NOT_VERIFIED') || error.message.includes('ACCOUNT_RESTRICTED')) {
        return NextResponse.json({ error: 'Your account is not eligible for checkout.' }, { status: 403 });
      }
      return NextResponse.json({ error: 'Could not create your order. Please try again.' }, { status: 500 });
    }

    const row = (data as Array<{ out_reference: string | null; out_order_id: string | null; out_error: string | null; out_total_cents: number | null }>)[0];
    if (!row || !row.out_reference || !row.out_order_id) {
      return NextResponse.json({ error: row?.out_error || 'Could not create your order.' }, { status: 400 });
    }

    // Atomic wallet debit + durable fulfillment handoff enqueue, ONE
    // transaction on the customer-JWT client (row-locked, idempotent). If
    // either half fails the whole settlement rolls back: coins untouched and
    // the order stays in its pre-call state, so a retried checkout either
    // fully succeeds or fully fails.
    const { data: settle, error: settleError } = await customerClient.rpc(
      'rf_coin_settle_order_payment_and_enqueue',
      {
        p_order_id: row.out_order_id,
        p_user_id: user.id,
      },
    );
    const settleRow = Array.isArray(settle) ? settle[0] : settle;
    if (settleError || !settleRow || settleRow.out_error || !settleRow.out_coins || !settleRow.out_handoff_id) {
      // Release on failure: cancel the just-created order, coins stay untouched.
      const cancelCode = settleRow?.out_error || 'SETTLEMENT_FAILED';
      if (!settleRow?.out_error) {
        console.error('coin checkout: settle+enqueue returned without error payload',
          { hasError: Boolean(settleError), hasHandoff: Boolean(settleRow?.out_handoff_id) });
      }
      const { error: cancelError } = await adminSupabase!
        .from('orders')
        .update({ status: 'CANCELLED' })
        .eq('id', row.out_order_id)
        .eq('status', 'WAITING_PAYMENT');
      if (cancelError) {
        console.error('coin checkout: could not cancel order after failed settlement', cancelError);
      }
      const friendly = rfCoinErrorMessage(cancelCode, 'Could not create your order. Please try again.');
      return NextResponse.json({ error: friendly }, { status: 400 });
    }

    const response = NextResponse.json({
      reference: row.out_reference,
      totalCents: row.out_total_cents,
      coinsCharged: settleRow.out_coins,
      balanceAfter: settleRow.out_balance_after,
      handoffQueued: true,
    });
    response.cookies.set(orderCapabilityCookieName(row.out_reference), capability, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 24 * 60 * 60,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (err) {
    console.error('orders coin route error', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

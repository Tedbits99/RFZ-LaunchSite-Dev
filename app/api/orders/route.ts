import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { hashOrderCapability, orderCapabilityCookieName } from '@/lib/orderCapability';
import { validateVoucher } from '@/lib/voucher';
import { paymentMethodLabel } from '@/lib/paymentMethods';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gameId, packageId, email: submittedEmail, name, playerInputs, paymentMethod, voucherCode } = body;
    let email = typeof submittedEmail === 'string' ? submittedEmail.trim() : '';

    if (!gameId || !packageId || !email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please complete all required fields.' }, { status: 400 });
    }
    if (!paymentMethod || typeof paymentMethod !== 'string' || paymentMethod.length > 50) {
      return NextResponse.json({ error: 'Please select a valid payment method.' }, { status: 400 });
    }

    // Read the verified Auth identity from the request cookies. The existing
    // global anon/service clients cannot distinguish an authenticated
    // suspended customer from a guest checkout.
    let requestClient: ReturnType<typeof createSupabaseServerClient> | null = null;
    const hasAuthCookie = req.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
    try {
      requestClient = createSupabaseServerClient();
      const { data, error } = await requestClient.auth.getUser();
      if (error && hasAuthCookie) {
        return NextResponse.json({ error: 'Your session could not be verified.' }, { status: 401 });
      }
      if (!error && data.user) {
        if (!data.user.email_confirmed_at) {
          return NextResponse.json({ error: 'Please verify your email before checking out.' }, { status: 403 });
        }

        const { data: profile, error: profileError } = await requestClient
          .from('customer_profiles')
          .select('status')
          .eq('user_id', data.user.id)
          .maybeSingle();
        if (profileError || !profile || profile.status !== 'active') {
          return NextResponse.json({ error: 'Your account is not eligible for checkout.' }, { status: 403 });
        }
        // Authenticated orders use the independently verified Auth email, not
        // a browser-supplied address that could misroute receipts/history.
        email = data.user.email || '';
      }
    } catch {
      if (hasAuthCookie) {
        return NextResponse.json({ error: 'Your session could not be verified.' }, { status: 401 });
      }
      requestClient = null;
    }

    // Service role is retained only for catalog/supplier reads. The RPC must
    // always run with the request's anon/authenticated JWT so auth.uid() and
    // the database guest policy cannot be bypassed by a service-role fallback.
    const client = adminSupabase || requestClient || supabase;
    const rpcClient = requestClient || supabase;
    if (!client || !rpcClient) {
      return NextResponse.json({ error: 'Checkout is not configured. Please contact support.' }, { status: 503 });
    }

    const { data: packageRecord, error: packageError } = await client
      .from('packages')
      .select('id, game_id, price_cents, is_active, supplier_offer_id, supplier_category_id, games!inner(slug)')
      .eq('id', packageId)
      .eq('game_id', gameId)
      .maybeSingle();
    if (packageError || !packageRecord || !packageRecord.is_active || packageRecord.price_cents <= 0) {
      return NextResponse.json({ error: 'The selected package is no longer available.' }, { status: 400 });
    }

    const packageGame = Array.isArray(packageRecord.games) ? packageRecord.games[0] : packageRecord.games;
    if (packageGame?.slug === 'mobile-legends' || packageGame?.slug === 'mlbb') {
      if (packageRecord.supplier_category_id !== 'mobile_legends_philippines' || !packageRecord.supplier_offer_id) {
        return NextResponse.json({ error: 'The selected package is no longer available.' }, { status: 400 });
      }
      const { data: supplier } = await client
        .from('suppliers')
        .select('id')
        .eq('code', 'fazercards')
        .eq('enabled', true)
        .maybeSingle();
      const { data: mapping } = supplier ? await client
        .from('supplier_package_mappings')
        .select('id')
        .eq('package_id', packageId)
        .eq('supplier_id', supplier.id)
        .eq('supplier_product_id', packageRecord.supplier_offer_id)
        .eq('enabled', true)
        .maybeSingle() : { data: null };
      if (!mapping) {
        return NextResponse.json({ error: 'The selected package is no longer available.' }, { status: 400 });
      }
    }

    // If a voucher code is provided, pre-validate it for a friendlier error
    // before the atomic create_order call. The authoritative validation +
    // consumption happens inside the SECURITY DEFINER function.
    // Use the REAL package price so minimum-order checks are accurate here;
    // create_order re-checks everything authoritatively.
    const code = (voucherCode || '').trim().toUpperCase();
    if (code) {
      const validation = await validateVoucher({ code, subtotalCents: packageRecord.price_cents, gameId, email });
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    // Atomic order creation via SECURITY DEFINER function.
    const capability = randomBytes(32).toString('base64url');
    const safePlayerInputs = playerInputs && typeof playerInputs === 'object' && !Array.isArray(playerInputs)
      ? playerInputs as Record<string, unknown>
      : {};

    const { data, error } = await rpcClient.rpc('create_order', {
      p_game_id: gameId,
      p_package_id: packageId,
      p_email: email.trim(),
      p_customer_name: name || 'Guest',
      p_player_inputs: {
        ...safePlayerInputs,
        __rfz_order_access_hash: hashOrderCapability(capability),
      },
      p_payment_method: paymentMethod,
      p_voucher_code: code || null,
      p_voucher_email: email.trim(),
    });

    if (error) {
      if (error.message.includes('GUEST_CHECKOUT_DISABLED')) {
        return NextResponse.json({ error: 'Guest checkout is currently disabled. Please sign in to continue.' }, { status: 403 });
      }
      if (error.message.includes('CHECKOUT_POLICY_UNAVAILABLE')) {
        return NextResponse.json({ error: 'Checkout is temporarily unavailable. Please try again later.' }, { status: 503 });
      }
      if (error.message.includes('EMAIL_NOT_VERIFIED') || error.message.includes('ACCOUNT_RESTRICTED')) {
        return NextResponse.json({ error: 'Your account is not eligible for checkout.' }, { status: 403 });
      }
      return NextResponse.json({ error: 'Could not create your order. Please try again.' }, { status: 500 });
    }

    const row = (data as Array<{ out_reference: string | null; out_error: string | null; out_total_cents: number | null }>)[0];
    if (!row || !row.out_reference) {
      return NextResponse.json({ error: row?.out_error || 'Could not create your order.' }, { status: 400 });
    }

    const { data: payConfig } = await client
      .from('payment_config')
      .select('qr_data, display_name')
      .eq('method_key', paymentMethod)
      .maybeSingle();

    const response = NextResponse.json({
      reference: row.out_reference,
      totalCents: row.out_total_cents,
      qrData: payConfig?.qr_data || null,
      paymentDisplayName: payConfig?.display_name || paymentMethodLabel(paymentMethod),
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
    console.error('orders route error', err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { getPaymentAdapter, buildProviderConfig } from '@/lib/paymentProviderAdapters';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';
import { authorizeOrderRequest } from '@/lib/orderCapability';

/*
  Create an automated payment for an existing order.
  
  POST body: { orderReference, email, configId? }
  
  1. Find order by reference + email
  2. Find the automated payment config
  3. Create payment via provider adapter
  4. Record the payment transaction
  5. Return the checkout URL
*/

export async function POST(req: NextRequest) {
  if (!adminSupabase) {
    return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const { orderReference, email, configId } = body;

    const normalizedEmail = normalizeOrderEmail(email);
    if (!orderReference || !normalizedEmail) {
      return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    }

    // Find the order
    const { data: order } = await adminSupabase
      .from('orders')
      .select('id, reference, email, customer_user_id, status, total_cents, payment_method')
      .eq('reference', String(orderReference).toUpperCase().trim())
      .maybeSingle();

    if (!order || !isOrderOwner(normalizedEmail, order.email) || !await authorizeOrderRequest(req, order)) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    if (order.status !== 'WAITING_PAYMENT') {
      return NextResponse.json({ error: 'Order is not awaiting payment.' }, { status: 400 });
    }

    // Idempotency: check if a payment is already pending for this order
    const idempotencyKey = `pay_${order.id}`;
    const { data: existingTx } = await (adminSupabase.from('payment_transactions') as any)
      .select('id, checkout_url, provider_reference, status')
      .eq('idempotency_key', idempotencyKey)
      .in('status', ['pending', 'processing'])
      .maybeSingle();

    if (existingTx?.checkout_url) {
      return NextResponse.json({
        success: true,
        checkoutUrl: existingTx.checkout_url,
        providerReference: existingTx.provider_reference,
        message: 'Existing payment session found.',
      });
    }

    // Find the automated payment config
    let config: any;
    if (configId) {
      const { data } = await (adminSupabase.from('payment_config') as any)
        .select('*')
        .eq('id', configId)
        .eq('is_enabled', true)
        .eq('provider_type', 'automated')
        .maybeSingle();
      config = data;
    } else {
      const { data } = await (adminSupabase.from('payment_config') as any)
        .select('*')
        .eq('is_enabled', true)
        .eq('provider_type', 'automated')
        .order('sort_order')
        .limit(1)
        .maybeSingle();
      config = data;
    }

    if (!config) {
      return NextResponse.json({ error: 'No automated payment provider is configured.' }, { status: 400 });
    }

    const adapter = getPaymentAdapter(config.provider_name);
    if (!adapter) {
      return NextResponse.json({ error: `Payment provider "${config.provider_name}" is not supported.` }, { status: 400 });
    }

    const providerConfig = buildProviderConfig(
      config.provider_name,
      config.api_url || '',
      config.is_test_mode || false,
      config.currency || 'PHP',
    );

    // Construct webhook URL
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('.supabase.co', '') || '';
    const webhookUrl = config.webhook_url || (baseUrl ? `${baseUrl}/api/webhooks/payment?provider=${config.provider_name}` : '');
    const redirectUrl = baseUrl ? `${baseUrl}/checkout?ref=${order.reference}` : '';

    const result = await adapter.createPayment(providerConfig, {
      orderId: order.id,
      orderReference: order.reference,
      amountCents: order.total_cents,
      currency: config.currency || 'PHP',
      email: order.email,
      description: `Order ${order.reference}`,
      redirectUrl,
      webhookUrl,
      idempotencyKey,
      metadata: { order_id: order.id, order_reference: order.reference },
    });

    // Record the payment transaction
    await (adminSupabase.from('payment_transactions') as any).insert({
      order_id: order.id,
      idempotency_key: idempotencyKey,
      provider_name: config.provider_name,
      provider_reference: result.providerReference || null,
      action: 'create',
      status: result.success ? 'pending' : 'failed',
      amount_cents: order.total_cents,
      currency: config.currency || 'PHP',
      checkout_url: result.checkoutUrl || null,
      error_message: result.error || null,
      metadata: { raw_response: result.rawResponse },
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Payment creation failed.' }, { status: 500 });
    }

    // Update order with provider info
    await (adminSupabase.from('orders') as any).update({
      payment_provider: config.provider_name,
      payment_mode: 'automated',
      provider_checkout_url: result.checkoutUrl || null,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);

    return NextResponse.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
      providerReference: result.providerReference,
      amountCents: order.total_cents,
    });
  } catch {
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}

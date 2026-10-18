import { createHash, createHmac, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { normalizeOrderEmail } from '@/lib/orderAccess';

export const runtime = 'nodejs';

const genericResponse = () => NextResponse.json(
  { message: 'If the order details match, an access code will be sent to the checkout email.' },
  { headers: { 'Cache-Control': 'no-store' } },
);

export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminSupabase || !serviceKey) {
    return NextResponse.json({ error: 'Order recovery is temporarily unavailable.' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : '';
    const email = normalizeOrderEmail(body.email);
    if (!/^RF-[A-HJ-NP-Z2-9]{6}$/.test(reference) || !email) return genericResponse();

    const code = randomBytes(32).toString('base64url');
    const codeHash = createHash('sha256').update(code).digest('hex');
    // Proxy-provided client IP is HMACed with the service key before it is
    // stored. Never persist or log a raw address or recovery code.
    const remoteAddress = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 128);
    const rateLimitKey = createHmac('sha256', serviceKey).update(remoteAddress).digest('hex');

    const { data: created, error } = await adminSupabase.rpc('create_guest_order_access_challenge', {
      p_reference: reference,
      p_email: email,
      p_code_hash: codeHash,
      p_rate_limit_key: rateLimitKey,
    });

    if (error) return NextResponse.json({ error: 'Order recovery is temporarily unavailable.' }, { status: 503 });
    if (created) {
      const { data: order } = await adminSupabase
        .from('orders')
        .select('id, email, reference')
        .eq('reference', reference)
        .maybeSingle();
      if (order) {
        const { error: mailError } = await adminSupabase.functions.invoke('send-transactional-email', {
          body: {
            order_id: order.id,
            template: 'guest_order_access',
            to: order.email,
            order_reference: order.reference,
            access_code: code,
          },
        });
        if (mailError) {
          // Do not reveal whether an order/email pair matched or log secrets.
          await adminSupabase.from('guest_order_access_challenges')
            .update({ consumed_at: new Date().toISOString() })
            .eq('order_id', order.id)
            .eq('code_hash', codeHash);
        }
      }
    }
    return genericResponse();
  } catch {
    return genericResponse();
  }
}

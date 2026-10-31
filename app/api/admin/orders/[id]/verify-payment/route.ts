import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { requireAdminPermission } from '@/lib/adminGuard';
import { sendPaymentSuccessEmail } from '@/lib/transactionalEmail';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminPermission(req, 'payments.manage');
  if (!session.ok) return session.response;

  const client = adminSupabase || supabase;
  if (!client) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  try {
    const body = await req.json().catch(() => ({}));
    const note = (body.note || '').trim().slice(0, 500);
    const paymentReference = (body.payment_reference || '').trim().slice(0, 200) || null;

    // Call verify_payment RPC — sets payment_status=VERIFIED, status=PAYMENT_VERIFIED
    // Does NOT trigger fulfillment. Idempotent — safe for duplicate clicks.
    const { data: rpcResult, error: rpcError } = await client.rpc('verify_payment', {
      p_order_id: id,
      p_verified_by: session.session.email,
      p_verification_method: 'MANUAL',
      p_payment_reference: paymentReference,
      p_note: note || 'Payment verified by Super Admin',
    });

    if (rpcError) {
      const msg = rpcError.message || '';
      if (msg.includes('ORDER_NOT_FOUND')) {
        return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
      }
      if (msg.includes('INVALID_PAYMENT_STATE')) {
        return NextResponse.json({ error: 'Payment cannot be verified in its current state.' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Failed to verify payment.' }, { status: 500 });
    }

    const result = rpcResult?.[0] || rpcResult;

    // Send payment-success email (fire-and-forget, duplicate-guarded by email_sent_log).
    // Only sends if payment_status actually transitioned to VERIFIED.
    if (result?.out_payment_status === 'VERIFIED' || !rpcError) {
      sendPaymentSuccessEmail(client, id).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      payment_status: result?.out_payment_status || 'VERIFIED',
      fulfillment_status: result?.out_fulfillment_status || 'NOT_STARTED',
      order_status: result?.out_order_status || 'PAYMENT_VERIFIED',
    });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

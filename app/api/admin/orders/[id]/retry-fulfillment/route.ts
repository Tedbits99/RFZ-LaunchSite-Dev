import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';
import { startFulfillment } from '@/lib/suppliers/fulfillment';
import { sendFulfillmentFailedEmail } from '@/lib/transactionalEmail';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  try {
    // 1. Check that payment is verified before allowing retry
    const { data: order } = await session.client
      .from('orders')
      .select('id, payment_status, fulfillment_status')
      .eq('id', params.id)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    if (order.payment_status !== 'VERIFIED') {
      return NextResponse.json({ error: 'Payment must be verified before retrying fulfillment.' }, { status: 400 });
    }

    // 2. If fulfillment is PROCESSING, distinguish active from stale:
    //    - Has a submitted/success/pending supplier transaction → in progress, block
    //    - No supplier transaction → stale (crashed before pre-persisting), allow recovery
    if (order.fulfillment_status === 'PROCESSING') {
      const { data: activeTx } = await (session.client.from('supplier_transactions') as any)
        .select('id, supplier_reference, status')
        .eq('order_id', params.id)
        .eq('action', 'create_order')
        .in('status', ['submitted', 'success', 'pending'])
        .maybeSingle();

      if (activeTx) {
        return NextResponse.json({
          ok: true,
          message: 'Fulfillment is already in progress. The supplier order exists — no duplicate will be created.',
          fulfillment_status: 'PROCESSING',
          supplier_reference: activeTx.supplier_reference,
        });
      }

      // Stale PROCESSING — no supplier transaction exists. The previous
      // fulfillment attempt crashed before pre-persisting a transaction record.
      // Fall through to reset and retry.
    }

    // 2a. Cannot retry a COMPLETED order — it was already successfully fulfilled
    if (order.fulfillment_status === 'COMPLETED') {
      return NextResponse.json({
        error: 'Cannot retry fulfillment for an already completed order.',
      }, { status: 400 });
    }

    // 3. Reset fulfillment_status to NOT_STARTED so the gate allows retry
    await session.client
      .from('orders')
      .update({ fulfillment_status: 'NOT_STARTED', updated_at: new Date().toISOString() })
      .eq('id', params.id);

    // 4. Insert timeline entry for the retry
    await session.client.from('order_timeline').insert({
      order_id: params.id,
      status: 'FULFILLMENT_RETRY',
      actor_email: session.session.email,
      note: 'Admin requested fulfillment retry',
    });

    // 5. Start fulfillment (the gate will pass since payment is VERIFIED
    //    and fulfillment is NOT_STARTED; existing supplier_transaction
    //    dedup prevents duplicate FazerCards orders)
    const result = await startFulfillment(params.id, session.client);

    if (!result.success) {
      // Send fulfillment-failed email (fire-and-forget, duplicate-guarded).
      sendFulfillmentFailedEmail(session.client, params.id, result.error || 'Fulfillment retry failed').catch(() => {});
    }

    return NextResponse.json({
      ok: result.success,
      fulfillment_status: result.success ? 'PROCESSING' : 'FAILED',
      supplier_reference: result.supplierReference || null,
      error: result.error || undefined,
    });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

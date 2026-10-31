import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/adminGuard';
import { startFulfillment } from '@/lib/suppliers/fulfillment';
import { sendFulfillmentFailedEmail } from '@/lib/transactionalEmail';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminPermission(req, 'suppliers.manage');
  if (!session.ok) return session.response;

  try {
    // Gate: payment must be VERIFIED and fulfillment must be NOT_STARTED
    const { data: order } = await session.client
      .from('orders')
      .select('id, payment_status, fulfillment_status')
      .eq('id', id)
      .maybeSingle();

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
    }

    if (order.payment_status !== 'VERIFIED') {
      return NextResponse.json({ error: 'Payment must be verified before starting fulfillment.' }, { status: 400 });
    }

    if (order.fulfillment_status === 'COMPLETED') {
      return NextResponse.json({ error: 'Fulfillment is already completed.' }, { status: 400 });
    }

    if (order.fulfillment_status === 'PROCESSING') {
      return NextResponse.json({ error: 'Fulfillment is already in progress.' }, { status: 400 });
    }

    // fulfillment_status must be NOT_STARTED to begin
    if (order.fulfillment_status !== 'NOT_STARTED') {
      return NextResponse.json({ error: 'Fulfillment cannot be started from the current state.' }, { status: 400 });
    }

    const result = await startFulfillment(id, session.client);

    if (!result.success) {
      sendFulfillmentFailedEmail(session.client, id, result.error || 'Fulfillment failed to start').catch(() => {});
      return NextResponse.json({
        ok: false,
        error: result.error || 'Fulfillment failed to start.',
        fulfillment_status: 'FAILED',
      }, { status: 200 });
    }

    return NextResponse.json({
      ok: true,
      fulfillment_status: 'PROCESSING',
      supplier_reference: result.supplierReference || null,
    });
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}

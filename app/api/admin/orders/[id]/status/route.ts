import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdminPermission } from '@/lib/adminGuard'

// Only admin-controlled statuses are allowed via the manual Update Status dropdown.
// System-controlled statuses (PENDING, WAITING_PAYMENT, PAID, PROCESSING, COMPLETED,
// FULFILLMENT_FAILED, FAILED, EXPIRED) are set by the fulfillment/payment system, not manually.
const ADMIN_STATUSES = [
  'PAYMENT_VERIFIED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED',
]

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdminPermission(req, 'orders.edit')
  if (!session.ok) return session.response

  const client = adminSupabase || supabase
  if (!client) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 })

  try {
    const body = await req.json()
    const { status, note } = body

    if (!status || !ADMIN_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }

    if (status === 'PAYMENT_VERIFIED') {
      const paymentAuth = await requireAdminPermission(req, 'payments.manage')
      if (!paymentAuth.ok) return paymentAuth.response
    }
    if (status === 'REFUND_PENDING' || status === 'REFUNDED') {
      const refundAuth = await requireAdminPermission(req, 'payments.refund')
      if (!refundAuth.ok) return refundAuth.response
    }

    const noteText = (note || '').trim().slice(0, 500)

    // PAYMENT_VERIFIED via the status dropdown means "admin confirmed payment."
    // Use the verify_payment RPC to ensure payment_status is also set correctly.
    if (status === 'PAYMENT_VERIFIED') {
      const { data: rpcResult, error: rpcError } = await client.rpc('verify_payment', {
        p_order_id: id,
        p_verified_by: session.session.email,
        p_verification_method: 'MANUAL',
        p_note: noteText || 'Payment verified by admin via Update Status',
      })

      if (rpcError) {
        const msg = rpcError.message || ''
        if (msg.includes('ORDER_NOT_FOUND')) {
          return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
        }
        if (msg.includes('INVALID_PAYMENT_STATE')) {
          return NextResponse.json({ error: 'Payment cannot be verified in its current state.' }, { status: 400 })
        }
        return NextResponse.json({ error: 'Failed to verify payment.' }, { status: 500 })
      }

      const result = rpcResult?.[0] || rpcResult
      return NextResponse.json({ ok: true, status: result?.out_order_status || 'PAYMENT_VERIFIED' })
    }

    // For other admin statuses (CANCELLED, REFUND_PENDING, REFUNDED), use the generic RPC
    const { data, error } = await client.rpc('admin_change_order_status', {
      p_order_id: id,
      p_new_status: status,
      p_actor_email: session.session.email,
      p_note: noteText,
    })

    if (error) {
      const msg = error.message || ''
      if (msg.includes('ORDER_NOT_FOUND')) {
        return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
      }
      if (msg.includes('COMPLETED_NOT_ALLOWED_MANUALLY')) {
        return NextResponse.json({ error: 'Completed status can only be set by the fulfillment system, not manually.' }, { status: 400 });
      }
      if (msg.includes('INVALID_TRANSITION')) {
        return NextResponse.json({ error: `Cannot change to ${status} from the current status.` }, { status: 400 })
      }
      return NextResponse.json({ error: 'Failed to update order status.' }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, status: data[0].out_status || status })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}

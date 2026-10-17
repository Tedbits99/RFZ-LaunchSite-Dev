import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminGuard'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  const db = adminSupabase || supabase
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 })

  try {
    const body = await req.json()
    const { reason } = body

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: 'Refund reason is required.' }, { status: 400 })
    }

    const { data: order } = await db
      .from('orders')
      .select('id, reference, status, total_cents, payment_method')
      .eq('id', params.id)
      .maybeSingle()

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (!['PAID', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'REFUND_PENDING'].includes(order.status)) {
      return NextResponse.json({ error: 'This order cannot be refunded in its current status.' }, { status: 400 })
    }

    if (order.status !== 'REFUND_PENDING') {
      const { error: statusErr } = await db.rpc('admin_change_order_status', {
        p_order_id: params.id,
        p_new_status: 'REFUND_PENDING',
        p_actor_email: auth.session.email,
        p_note: 'Refund requested',
      })
      if (statusErr) {
        return NextResponse.json({ error: 'Failed to initiate refund.' }, { status: 500 })
      }
    }

    const refundRef = `RFD-${order.reference}-${Date.now().toString(36).toUpperCase()}`
    const { error: refundErr } = await db.from('refunds').insert({
      order_id: params.id,
      reference: refundRef,
      amount_cents: order.total_cents,
      reason: reason.trim().slice(0, 1000),
      status: 'REQUESTED',
      approved_by: auth.session.email,
    })

    if (refundErr) {
      return NextResponse.json({ error: 'Failed to create refund record.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, reference: refundRef, status: 'REFUND_PENDING' })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}

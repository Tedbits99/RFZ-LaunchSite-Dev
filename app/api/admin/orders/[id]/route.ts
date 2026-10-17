import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminGuard'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdmin(_req)
  if (!session.ok) return session.response

  const db = adminSupabase || supabase
  if (!db) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 })

  try {
    const { data: orderData, error } = await db
      .from('orders')
      .select('id, reference, email, customer_name, status, payment_status, fulfillment_status, payment_verification_method, subtotal_cents, discount_cents, total_cents, payment_method, payment_reference, payment_mode, payment_verified_at, payment_verified_by, created_at, updated_at, player_inputs, voucher_code, games(name), packages(name, amount)')
      .eq('id', params.id)
      .maybeSingle()

    if (error) {
      if (process.env.NODE_ENV !== 'production') console.error('Load order failed:', error)
      return NextResponse.json({ error: 'Failed to load order.', detail: error.message }, { status: 500 })
    }
    if (!orderData) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

    const { data: timelineData, error: timelineError } = await db
      .from('order_timeline')
      .select('id, status, actor_email, note, created_at')
      .eq('order_id', params.id)
      .order('created_at', { ascending: true })

    if (process.env.NODE_ENV !== 'production' && timelineError) console.error('Load order timeline failed:', timelineError)

    const { data: paymentData, error: paymentError } = await db
      .from('payment_submissions')
      .select('id, payment_method, reference_number, amount_cents, note, proof_url, submitted_at')
      .eq('order_id', params.id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (process.env.NODE_ENV !== 'production' && paymentError) console.error('Load payment submission failed:', paymentError)

    const { data: supplierTxData, error: supplierTxError } = await db
      .from('supplier_transactions')
      .select('id, supplier_id, supplier_reference, status, action, error_message, created_at, last_polled_at, suppliers(code, name)')
      .eq('order_id', params.id)
      .eq('action', 'create_order')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (process.env.NODE_ENV !== 'production' && supplierTxError) console.error('Load supplier transaction failed:', supplierTxError)

    return NextResponse.json({
      order: orderData,
      timeline: timelineData || [],
      paymentSubmission: paymentData || null,
      supplierTransaction: supplierTxData || null,
    })
  } catch {
    return NextResponse.json({ error: 'Server error.' }, { status: 500 })
  }
}

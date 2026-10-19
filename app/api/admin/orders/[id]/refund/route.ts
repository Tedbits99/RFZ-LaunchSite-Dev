import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { adminSupabase } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/adminGuard'
import { RF_COIN_PAYMENT_METHOD, rfCoinErrorMessage } from '@/lib/rfCoins'

/*
  RF Coins wallet refunds reverse the original wallet debit via the
  service-role-only RPC rf_coin_release_order_payment. The RPC row-locks the
  order, re-checks eligibility (payment VERIFIED, status PAYMENT_VERIFIED /
  CANCELLED / FAILED, never supplier-fulfilled), credits the wallet exactly
  once (ledger idempotency key 'order-reversal:<id>') and flips the order to
  REFUNDED in the SAME transaction. It must therefore run BEFORE any status
  transition: REFUND_PENDING is not an eligible state for reversal.

  Retry after a partial failure (reversal succeeded, refund-record insert
  failed): the order is now REFUNDED and the reversal RPC is NOT callable
  again — its eligibility check runs before its idempotency-key check, so it
  returns NOT_ELIGIBLE instead of "already reversed". The retry therefore
  verifies the completed reversal directly in rf_coin_ledger (keyed by the
  RPC's own idempotency key, so unrelated REFUNDED orders never match) and
  only then creates the missing refund record. Coins can never be credited
  twice: the ledger key is unique and no second RPC call is attempted.
*/

type RefundDb = NonNullable<typeof adminSupabase> | NonNullable<typeof supabase>

type CoinRefundOrder = {
  id: string
  reference: string
  status: string
  total_cents: number
  fulfillment_status: string
}

const COIN_REFUNDABLE_STATUSES = ['PAYMENT_VERIFIED', 'CANCELLED', 'FAILED']

// Shared tail of both the fresh-reversal and the retry path: dedupe the
// refund record, then record it plus a best-effort timeline entry.
async function recordCoinRefund(
  db: RefundDb,
  order: CoinRefundOrder,
  reason: string,
  adminEmail: string,
): Promise<NextResponse> {
  const { data: existing } = await db
    .from('refunds')
    .select('reference, status')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, reference: existing.reference, status: existing.status })
  }

  const refundRef = `RFD-${order.reference}-${Date.now().toString(36).toUpperCase()}`
  const { error: refundErr } = await db.from('refunds').insert({
    order_id: order.id,
    reference: refundRef,
    amount_cents: order.total_cents,
    reason,
    status: 'REFUNDED',
    approved_by: adminEmail,
  })
  if (refundErr) {
    // Coins are already back in the wallet; the retry path above records the
    // missing refund row without re-crediting (no second reversal is ever
    // attempted for a REFUNDED order).
    console.error('coin refund: reversal succeeded but refund record failed', refundErr)
    return NextResponse.json({ error: 'RF Coins were returned but the refund record could not be saved. Please retry.' }, { status: 500 })
  }

  // Best-effort timeline entry for admin audit parity; a failure here must
  // not fail the response because the wallet reversal already succeeded.
  await db.from('order_timeline').insert({
    order_id: order.id,
    status: 'REFUNDED',
    actor_email: adminEmail,
    note: `RF Coins wallet refund: ${reason}`.slice(0, 1000),
  })

  return NextResponse.json({ ok: true, reference: refundRef, status: 'REFUNDED' })
}

async function refundCoinOrder(
  db: RefundDb,
  order: CoinRefundOrder,
  reason: string,
  adminEmail: string,
): Promise<NextResponse> {
  if (order.status === 'REFUNDED') {
    // Retry after a successful reversal whose refund record failed to save.
    // Verify the completed reversal via the RPC's own ledger idempotency key:
    // an unrelated REFUNDED coin order (refunded without a wallet reversal)
    // has no such entry and is rejected here. Never call the reversal RPC
    // again for a REFUNDED order.
    const { data: reversal } = await db
      .from('rf_coin_ledger')
      .select('id')
      .eq('idempotency_key', `order-reversal:${order.id}`)
      .maybeSingle()
    if (!reversal) {
      return NextResponse.json({ error: 'This order was refunded without a wallet reversal; RF Coins cannot be returned automatically.' }, { status: 400 })
    }
    return recordCoinRefund(db, order, reason, adminEmail)
  }

  if (!COIN_REFUNDABLE_STATUSES.includes(order.status)) {
    return NextResponse.json({ error: 'This order cannot be refunded in its current status.' }, { status: 400 })
  }
  // Defense in depth on top of the RPC's own state check: never reverse a
  // wallet payment once supplier fulfillment has started or completed.
  if (['PROCESSING', 'COMPLETED'].includes(order.fulfillment_status)) {
    return NextResponse.json({ error: 'This order cannot be refunded in its current status.' }, { status: 400 })
  }

  const { data: release, error: releaseError } = await db.rpc('rf_coin_release_order_payment', {
    p_order_id: order.id,
    p_reason: `Admin refund: ${reason}`.slice(0, 1000),
  })
  if (releaseError) {
    // Nothing changed: the reversal is atomic, so the admin can simply retry.
    return NextResponse.json({ error: 'Failed to return RF Coins. No refund was recorded. Please try again.' }, { status: 500 })
  }
  const releaseRow = Array.isArray(release) ? release[0] : release
  if (!releaseRow?.out_released) {
    return NextResponse.json({ error: rfCoinErrorMessage(releaseRow?.out_error, 'RF Coins reversal failed.') }, { status: 400 })
  }

  return recordCoinRefund(db, order, reason, adminEmail)
}

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
      .select('id, reference, status, total_cents, payment_method, fulfillment_status')
      .eq('id', params.id)
      .maybeSingle()

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if ((order as { payment_method?: string }).payment_method === RF_COIN_PAYMENT_METHOD) {
      return refundCoinOrder(db, order as unknown as CoinRefundOrder, reason.trim(), auth.session.email)
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

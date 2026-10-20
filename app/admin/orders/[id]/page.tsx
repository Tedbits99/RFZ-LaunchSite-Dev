import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { requireAdminPageSession } from '@/lib/adminGuard';
import AdminOrderDetailClient from './AdminOrderDetailClient';

export const dynamic = 'force-dynamic';

type OrderDetail = {
  id: string;
  reference: string;
  email: string;
  customer_name: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  payment_verification_method: string | null;
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  payment_method: string;
  payment_reference: string | null;
  payment_submitted_at: string | null;
  payment_provider: string | null;
  payment_mode: string;
  payment_verified_at: string | null;
  payment_verified_by: string | null;
  provider_checkout_url: string | null;
  created_at: string;
  updated_at: string;
  player_inputs: Record<string, string>;
  voucher_code: string | null;
  games: { name: string } | null;
  packages: { name: string; amount: string } | null;
};

type TimelineEntry = {
  id: string;
  status: string;
  actor_email: string;
  note: string;
  created_at: string;
};

type PaymentSubmission = {
  id: string;
  payment_method: string;
  reference_number: string;
  amount_cents: number;
  note: string;
  proof_url: string | null;
  submitted_at: string;
};

type Refund = {
  id: string;
  reference: string;
  amount_cents: number;
  reason: string;
  status: string;
  approved_by: string;
  created_at: string;
};

type SupplierTransaction = {
  id: string;
  supplier_id: string;
  supplier_reference: string | null;
  status: string;
  action: string;
  error_message: string | null;
  attempt: number;
  idempotency_key: string | null;
  duration_ms: number | null;
  created_at: string;
  last_polled_at: string | null;
  suppliers: { code: string; name: string } | null;
};

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const adminSession = await requireAdminPageSession();
  const { id } = await params;
  const db = adminSupabase || supabase;
  if (!db) {
    return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>;
  }

  const { data: orderData, error: orderError } = await db
    .from('orders')
    .select('id, reference, email, customer_name, status, payment_status, fulfillment_status, payment_verification_method, total_cents, subtotal_cents, discount_cents, payment_method, payment_reference, payment_submitted_at, payment_provider, payment_mode, payment_verified_at, payment_verified_by, provider_checkout_url, created_at, updated_at, player_inputs, voucher_code, games(name), packages(name, amount)')
    .eq('id', id)
    .maybeSingle();

  if (orderError && process.env.NODE_ENV !== 'production') console.error('Admin order detail load failed:', orderError);

  const order = orderData as unknown as OrderDetail | null;
  if (!order) {
    return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Order not found.</div>;
  }

  const { data: timelineData } = await db
    .from('order_timeline')
    .select('id, status, actor_email, note, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  const timeline = (timelineData || []) as unknown as TimelineEntry[];

  const { data: paymentData } = await db
    .from('payment_submissions')
    .select('id, payment_method, reference_number, amount_cents, note, proof_url, submitted_at')
    .eq('order_id', id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const paymentSubmission = paymentData as unknown as PaymentSubmission | null;

  const { data: refundData } = await db
    .from('refunds')
    .select('id, reference, amount_cents, reason, status, approved_by, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const refund = refundData as unknown as Refund | null;

  const { data: supplierTxData } = await db
    .from('supplier_transactions')
    .select('id, supplier_id, supplier_reference, status, action, error_message, attempt, idempotency_key, duration_ms, created_at, last_polled_at, suppliers(code, name)')
    .eq('order_id', id)
    .eq('action', 'create_order')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const supplierTransaction = supplierTxData as unknown as SupplierTransaction | null;

  const adminEmail = adminSession.email || 'admin';

  return (
    <AdminOrderDetailClient
      order={order}
      timeline={timeline}
      paymentSubmission={paymentSubmission}
      refund={refund}
      supplierTransaction={supplierTransaction}
      adminEmail={adminEmail}
    />
  );
}

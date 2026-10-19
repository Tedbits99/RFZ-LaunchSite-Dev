import Link from 'next/link';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { orderCapabilityCookieName, verifyOrderCapability } from '@/lib/orderCapability';
import { paymentMethodLabel } from '@/lib/paymentMethods';
import { ArrowRight, BadgeCheck, ShieldCheck } from 'lucide-react';
import CheckoutPaymentForm from './CheckoutPaymentForm';
import QrPhPayment from './QrPhPayment';
import SiteFooter from '@/components/SiteFooter';

export const dynamic = 'force-dynamic';

type OrderDetail = {
  id: string;
  reference: string;
  email: string;
  status: string;
  total_cents: number;
  payment_method: string;
  payment_reference: string | null;
  payment_submitted_at: string | null;
  payment_mode: string | null;
  payment_provider: string | null;
  payment_config_snapshot: Record<string, unknown> | null;
  games?: { name: string } | null;
  packages?: { name: string } | null;
  player_inputs?: Record<string, unknown> | null;
};
type PaymentConfig = {
  id: string;
  method_key: string;
  display_name: string;
  account_name: string;
  account_number: string;
  instructions: string;
  qr_data: string | null;
  is_enabled: boolean;
  logo_url: string | null;
};

export default async function Checkout({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const resolvedSearchParams = await searchParams;
  let order: OrderDetail | null = null;
  let paymentConfigs: PaymentConfig[] = [];
  let verifiedName: string | null = null;

  const db = adminSupabase || supabase;

  if (resolvedSearchParams.ref && db) {
    const { data } = await db
      .from('orders')
      .select('id, reference, email, customer_user_id, status, total_cents, payment_method, payment_reference, payment_submitted_at, payment_mode, payment_provider, payment_config_snapshot, games(name), packages(name), player_inputs')
      .eq('reference', resolvedSearchParams.ref)
      .maybeSingle();
    const candidate = data as unknown as OrderDetail & { customer_user_id: string | null } | null;
    if (candidate) {
      const token = (await cookies()).get(orderCapabilityCookieName(candidate.reference))?.value;
      if (await verifyOrderCapability(candidate.id, candidate.reference, token)) {
        const { customer_user_id: _ownerId, ...safeOrder } = candidate;
        order = safeOrder;
      }
    }

    if (order) {
      const { data: configs } = await db
        .from('payment_config')
        .select('id, method_key, display_name, account_name, account_number, instructions, qr_data, is_enabled, logo_url')
        .eq('is_enabled', true)
        .order('sort_order');
      paymentConfigs = (configs || []) as unknown as PaymentConfig[];
      const savedUserId = String(order.player_inputs?.user_id ?? '');
      const savedZoneId = String(order.player_inputs?.zone_id ?? order.player_inputs?.server_id ?? '');
      if (savedUserId && savedZoneId) {
        const { data: verified } = await db
          .from('verified_users')
          .select('ign')
          .eq('user_id', savedUserId)
          .eq('zone_id', savedZoneId)
          .maybeSingle();
        verifiedName = verified?.ign ?? null;
      }
    }
  }

  const fmtP = (c: number) => `₱${(c / 100).toFixed(2)}`;
  // Use the payment config snapshot stored at order creation time so admin
  // changes to the live config don't alter historical order instructions.
  const snapshot = order?.payment_config_snapshot as {
    display_name?: string;
    account_name?: string;
    account_number?: string;
    instructions?: string;
    qr_data?: string | null;
    provider_type?: string;
    provider_name?: string;
  } | null;
  const activeConfig = order ? (snapshot ? {
    display_name: snapshot.display_name || paymentMethodLabel(order.payment_method),
    account_name: snapshot.account_name || '',
    account_number: snapshot.account_number || '',
    instructions: snapshot.instructions || '',
    qr_data: snapshot.qr_data || null,
    provider_type: snapshot.provider_type || 'manual',
    provider_name: snapshot.provider_name || '',
    logo_url: null as string | null,
  } : paymentConfigs.find((c) => c.method_key === order!.payment_method) || null) : null;

  const isQrPhAutomated = order?.payment_method === 'paymongo_qrph'
    || (activeConfig && typeof activeConfig === 'object' && 'provider_type' in activeConfig && activeConfig.provider_type === 'automated' && order?.payment_method === 'paymongo_qrph');

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto max-w-[760px] px-4 py-4"><a href="/" className="text-xs text-cyan-300">← Back to store</a></div></header>
      <div className="mx-auto max-w-[760px] px-4 py-16">
        {order ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-400/25 bg-[#0b1225] p-6 sm:p-8">
              <div className="flex items-center gap-3"><BadgeCheck className="text-emerald-300" size={24} /><div><h1 className="font-display text-2xl font-bold">Order Created</h1><p className="text-xs text-slate-400">Your order has been placed successfully.</p></div></div>
              <div className="mt-6 space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Reference</span><span className="font-mono text-cyan-300">{order.reference}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Game</span><span>{order.games?.name || '—'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Package</span><span>{order.packages?.name || '—'}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Payment Method</span><span className="flex items-center gap-2">{activeConfig?.logo_url ? (
                                    <img src={activeConfig.logo_url} alt={paymentMethodLabel(order.payment_method)} className="h-5 w-5 rounded object-contain" />
                ) : null}<span>{paymentMethodLabel(order.payment_method)}</span></span></div>
                <div className="flex justify-between"><span className="text-slate-500">Email</span><span className="text-slate-300">{order.email}</span></div>
                {verifiedName && <div className="flex justify-between"><span className="text-slate-500">Player Name</span><span className="font-semibold text-emerald-300">{verifiedName}</span></div>}
                <div className="flex justify-between border-t border-[#1b2a45] pt-3"><span className="text-slate-400">Total</span><span className="font-display text-xl font-bold text-cyan-300">{fmtP(order.total_cents)}</span></div>
              </div>
            </div>

            {/* QR Ph automated payment (includes live order status) */}
            {isQrPhAutomated && order.status === 'WAITING_PAYMENT' && (
              <QrPhPayment
                orderReference={order.reference}
                orderEmail={order.email}
                totalCents={order.total_cents}
                orderId={order.id}
                initialStatus={order.status}
              />
            )}

            {/* Payment instructions (manual methods only) */}
            {activeConfig && !isQrPhAutomated && order.status === 'WAITING_PAYMENT' && !order.payment_submitted_at && (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-6">
                <h2 className="font-display text-sm font-semibold text-cyan-300">Payment Instructions</h2>
                <p className="mt-2 text-xs text-slate-400">{activeConfig.instructions}</p>
                {activeConfig.account_name && <div className="mt-3 text-xs"><span className="text-slate-500">Account Name: </span><span className="text-slate-200">{activeConfig.account_name}</span></div>}
                {activeConfig.account_number && <div className="mt-1 text-xs"><span className="text-slate-500">Account Number: </span><span className="text-slate-200">{activeConfig.account_number}</span></div>}
                {activeConfig.qr_data && (
                  <div className="mt-4 rounded-xl border border-[#253451] bg-white p-3 inline-block">
                                        <img src={activeConfig.qr_data} alt="Payment QR code" className="h-40 w-40 object-contain" />
                    <p className="mt-2 text-center text-[10px] text-slate-500">Scan to pay · {paymentMethodLabel(order.payment_method)}</p>
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3 text-xs text-slate-400">
                  <ShieldCheck size={14} className="text-cyan-300" /> Send exactly {fmtP(order.total_cents)} to the account above, then submit your payment reference below.
                </div>
              </div>
            )}

            {/* Payment submission form (manual methods only) */}
            {order.status === 'WAITING_PAYMENT' && !order.payment_submitted_at && !isQrPhAutomated && (
              <CheckoutPaymentForm
                orderReference={order.reference}
                orderEmail={order.email}
                paymentMethod={order.payment_method}
                totalCents={order.total_cents}
              />
            )}

            {/* Payment submitted confirmation */}
            {order.payment_submitted_at && order.status === 'WAITING_PAYMENT' && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="text-amber-300" size={20} />
                  <div>
                    <h2 className="font-display text-sm font-semibold text-amber-300">Payment Submitted</h2>
                    <p className="text-xs text-slate-400">Your payment is being verified. You will be notified once confirmed.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Status updates */}
            {order.status !== 'WAITING_PAYMENT' && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-6">
                <div className="flex items-center gap-3">
                  <BadgeCheck className="text-emerald-300" size={20} />
                  <div>
                    <h2 className="font-display text-sm font-semibold text-emerald-300">Status: {order.status}</h2>
                    <p className="text-xs text-slate-400">Track your order for the latest updates.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Link href={`/track-order?ref=${encodeURIComponent(order.reference)}`} className="flex-1 rounded-xl border border-[#253451] px-4 py-3 text-center text-xs font-semibold text-slate-200 hover:border-cyan-400">Track This Order</Link>
              <Link href="/" className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-3 text-center text-xs font-semibold">Back to Store</Link>
            </div>
          </div>
        ) : (
          <div>
            <h1 className="font-display text-3xl font-bold">Checkout</h1>
            <p className="mt-2 text-sm text-slate-400">Select a game to start your top-up order.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Link href="/#games" className="card-hover rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6"><h2 className="font-display font-semibold">Browse Games</h2><p className="mt-1 text-xs text-slate-400">Pick from our catalog of top-up games.</p><span className="mt-3 inline-flex items-center text-xs text-cyan-300">Get started <ArrowRight size={12} className="ml-1" /></span></Link>
              <div className="rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6"><h2 className="font-display font-semibold">Secure Payment</h2><p className="mt-1 text-xs text-slate-400">Multiple payment options available after order.</p><span className="mt-3 inline-flex items-center text-xs text-emerald-300"><ShieldCheck size={12} className="mr-1" /> Protected checkout</span></div>
            </div>
          </div>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}

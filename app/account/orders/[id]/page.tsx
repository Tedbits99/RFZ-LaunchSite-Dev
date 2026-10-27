import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getActiveCustomerSession } from '@/lib/customerSession';
import AccountOrderDetailClient from './AccountOrderDetailClient';
import { getCustomerLoginUrl } from '@/lib/authRedirect';
import RetryServerDataButton from '@/components/account/RetryServerDataButton';

export const dynamic = 'force-dynamic';

type Order = {
  id: string;
  reference: string;
  email: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  total_cents: number;
  created_at: string;
  updated_at: string;
  player_inputs: Record<string, string>;
  payment_method: string;
  games?: { name: string } | null;
  packages?: { name: string; amount: string } | null;
};

type TimelineEntry = {
  id: string;
  status: string;
  created_at: string;
};

export default async function AccountOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getActiveCustomerSession();

  // Guest access is handled by /track-order after one-time email verification;
  // account detail pages authorize only by the verified Auth UUID.
  if (!session) redirect(getCustomerLoginUrl(`/account/orders/${encodeURIComponent(id)}`));

  const client = session.client;

  const { data, error } = await client
    .from('orders')
    .select('id, reference, email, status, payment_status, fulfillment_status, total_cents, created_at, updated_at, player_inputs, payment_method, games(name), packages(name, amount)')
    .eq('id', id)
    .eq('customer_user_id', session.user.id)
    .maybeSingle();
  const order = data as unknown as Order | null;
  if (error) {
    return (
      <main className="grid min-h-[60vh] place-items-center bg-[#030718] px-5 py-12 text-slate-100">
        <section className="max-w-lg rounded-2xl border border-rose-400/25 bg-[#0b1225] p-6" role="alert">
          <h1 className="font-display text-lg font-semibold">Order details are temporarily unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">We could not load this order right now. Your order and payment records have not been changed.</p>
          <RetryServerDataButton />
          <Link className="ml-3 inline-flex min-h-10 items-center text-xs text-cyan-200 underline underline-offset-4" href="/account/orders">Back to orders</Link>
        </section>
      </main>
    );
  }
  if (!order) notFound();

  const { data: timelineData, error: timelineError } = await client
    .from('order_timeline')
    .select('id, status, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  const timeline = (timelineData || []) as unknown as TimelineEntry[];

  return <AccountOrderDetailClient order={order} timeline={timeline} timelineUnavailable={Boolean(timelineError)} />;
}

import { notFound, redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import AccountOrderDetailClient from './AccountOrderDetailClient';
import { getCustomerLoginUrl } from '@/lib/authRedirect';

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

  const { data } = await client
    .from('orders')
    .select('id, reference, email, status, payment_status, fulfillment_status, total_cents, created_at, updated_at, player_inputs, payment_method, games(name), packages(name, amount)')
    .eq('id', id)
    .eq('customer_user_id', session.user.id)
    .maybeSingle();
  const order = data as unknown as Order | null;
  if (!order) notFound();

  const { data: timelineData } = await client
    .from('order_timeline')
    .select('id, status, created_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });
  const timeline = (timelineData || []) as unknown as TimelineEntry[];

  return <AccountOrderDetailClient order={order} timeline={timeline} />;
}

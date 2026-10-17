import { notFound } from 'next/navigation';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import AccountOrderDetailClient from './AccountOrderDetailClient';

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
  note: string;
  created_at: string;
};

export default async function AccountOrderDetail({ params }: { params: { id: string } }) {
  let authenticatedUserId: string | null = null;
  let authClient: ReturnType<typeof createSupabaseServerClient> | null = null;
  try {
    authClient = createSupabaseServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    authenticatedUserId = user?.id || null;
  } catch {
    authenticatedUserId = null;
  }

  // Guest access is handled by /track-order after one-time email verification;
  // account detail pages authorize only by the verified Auth UUID.
  if (!authenticatedUserId || !authClient) notFound();

  const client = adminSupabase || authClient;
  if (!client) return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>;

  const { data } = await client
    .from('orders')
    .select('id, reference, email, status, payment_status, fulfillment_status, total_cents, created_at, updated_at, player_inputs, payment_method, games(name), packages(name, amount)')
    .eq('id', params.id)
    .eq('customer_user_id', authenticatedUserId)
    .maybeSingle();
  const order = data as unknown as Order | null;
  if (!order) notFound();

  const { data: timelineData } = await client
    .from('order_timeline')
    .select('id, status, note, created_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true });
  const timeline = (timelineData || []) as unknown as TimelineEntry[];

  return <AccountOrderDetailClient order={order} timeline={timeline} />;
}

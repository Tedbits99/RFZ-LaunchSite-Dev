import { notFound } from 'next/navigation';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { isOrderOwner, normalizeOrderEmail } from '@/lib/orderAccess';
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

export default async function AccountOrderDetail({ params, searchParams }: { params: { id: string }; searchParams: { email?: string } }) {
  let authenticatedEmail: string | null = null;
  try {
    const authClient = createSupabaseServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    authenticatedEmail = normalizeOrderEmail(user?.email);
  } catch {
    authenticatedEmail = null;
  }

  // Authenticated users are bound to their session email. Guests must provide
  // the same order-specific email proof used by the tracking flow.
  const accessEmail = authenticatedEmail || normalizeOrderEmail(searchParams.email);
  if (!accessEmail) notFound();

  // Prefer the service-role client, but fall back to the anon client so the
  // page still renders in runtimes where the service key is not injected
  // (RLS allows anon SELECT on orders/order_timeline). Without this fallback
  // the client component never mounts and no live updates can reach the UI.
  const client = adminSupabase || supabase;
  if (!client) return <div className="grid min-h-screen place-items-center bg-[#030718] text-slate-400">Database not configured.</div>;

  const { data } = await client
    .from('orders')
    .select('id, reference, email, status, payment_status, fulfillment_status, total_cents, created_at, updated_at, player_inputs, payment_method, games(name), packages(name, amount)')
    .eq('id', params.id)
    .maybeSingle();
  const order = data as unknown as Order | null;
  if (!order || !isOrderOwner(accessEmail, order.email)) notFound();

  const { data: timelineData } = await client
    .from('order_timeline')
    .select('id, status, note, created_at')
    .eq('order_id', params.id)
    .order('created_at', { ascending: true });
  const timeline = (timelineData || []) as unknown as TimelineEntry[];

  return <AccountOrderDetailClient order={order} timeline={timeline} accessEmail={accessEmail} />;
}

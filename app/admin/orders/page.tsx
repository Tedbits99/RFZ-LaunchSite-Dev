import { adminSupabase } from '@/lib/supabaseAdmin';
import { supabase } from '@/lib/supabase';
import OrdersManager from './OrdersManager';

export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  reference: string;
  email: string;
  status: string;
  total_cents: number;
  created_at: string;
  payment_status?: string;
  fulfillment_status?: string;
  games?: { name: string } | null;
  packages?: { name: string } | null;
  supplier_transactions?: { supplier_reference: string | null; status: string; suppliers?: { code: string; name: string } | null }[] | null;
};

export default async function AdminOrdersPage({ searchParams }: { searchParams: { q?: string; status?: string; date?: string; archived?: string } }) {
  let orders: OrderRow[] = [];
  let dbReady = false;
  let statusCounts: Record<string, number> = {};

  const db = adminSupabase || supabase;
  if (db) {
    dbReady = true;

    // Run archive cleanup on page load so the list is always current
    try { await db.rpc('archive_old_unpaid_orders'); } catch {}

    const showArchived = searchParams.archived === '1';

    let query = db
      .from('orders')
      .select('id, reference, email, status, total_cents, created_at, payment_status, fulfillment_status, games(name), packages(name), supplier_transactions!left(supplier_reference, status, action, suppliers(code, name))')
      .order('created_at', { ascending: false })
      .limit(100);

    // Exclude archived orders unless explicitly viewing archived
    query = query.eq('is_archived', showArchived);

    if (searchParams.status && searchParams.status !== 'ALL') {
      query = query.eq('status', searchParams.status);
    }
    if (searchParams.q) {
      const q = searchParams.q.replace(/[%_]/g, '\\$&');
      query = query.or(`reference.ilike.%${q}%,email.ilike.%${q}%`);
    }
    if (searchParams.date) {
      const d = searchParams.date;
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      query = query.gte('created_at', `${d}T00:00:00Z`).lt('created_at', `${next.toISOString().slice(0, 10)}T00:00:00Z`);
    }

    const { data } = await query;
    orders = (data || []) as unknown as OrderRow[];

    // Status counts only include non-archived orders
    const { data: counts } = await db
      .from('orders')
      .select('status')
      .eq('is_archived', false);
    if (counts) {
      for (const row of counts as { status: string }[]) {
        statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
      }
    }
  }

  return <OrdersManager orders={orders} dbReady={dbReady} searchParams={searchParams} statusCounts={statusCounts} />;
}

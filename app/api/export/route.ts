import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/supabaseAdmin';
import { requireAdminPermission } from '@/lib/adminGuard';

function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.pathname.endsWith('/games') ? 'games' : 'orders';
  const auth = await requireAdminPermission(req, type === 'games' ? 'games.manage' : 'orders.view');
  if (!auth.ok) return auth.response;
  const db = adminSupabase || auth.client;
  if (!db) return new NextResponse('Database not configured', { status: 503 });

  if (type === 'orders') {
    const { searchParams } = new URL(req.url);
    const detailed = searchParams.get('detailed') === '1';

    // Shared filter parameters (same as admin orders page)
    const q = searchParams.get('q')?.trim() || '';
    const status = searchParams.get('status')?.trim() || 'ALL';
    const date = searchParams.get('date')?.trim() || '';

    if (detailed) {
      let query = db
        .from('orders')
        .select('reference,email,customer_name,status,payment_status,fulfillment_status,payment_method,payment_reference,total_cents,created_at,updated_at,games(name),packages(name),supplier_transactions(supplier_reference)')
        .order('created_at', { ascending: false })
        .limit(500)
        .eq('is_archived', false);

      if (status && status !== 'ALL') {
        query = query.eq('status', status);
      }
      if (q) {
        const escaped = q.replace(/[%_]/g, '\\$&');
        query = query.or(`reference.ilike.%${escaped}%,email.ilike.%${escaped}%`);
      }
      if (date) {
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        query = query.gte('created_at', `${date}T00:00:00Z`).lt('created_at', `${next.toISOString().slice(0, 10)}T00:00:00Z`);
      }

      const { data } = await query;
      const rows = (data || []) as unknown as Array<Record<string, unknown>>;

      const header = 'Reference,Customer Email,Customer Name,Game,Package,Amount,Order Status,Payment Status,Fulfillment Status,Payment Method,Payment Reference,Supplier Reference,Created At,Updated At';
      const body = rows.map((r) => [
        r.reference,
        r.email,
        r.customer_name,
        (r.games as { name: string } | null)?.name || '',
        (r.packages as { name: string } | null)?.name || '',
        r.total_cents,
        r.status,
        r.payment_status,
        r.fulfillment_status,
        r.payment_method,
        r.payment_reference,
        ((r.supplier_transactions as Array<{ supplier_reference: string | null }> | null)?.[0]?.supplier_reference) || '',
        r.created_at,
        r.updated_at,
      ].map(csvField).join(',')).join('\n');

      return new NextResponse(`${header}\n${body}`, {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="orders-detailed.csv"' },
      });
    }

    const { data } = await db
      .from('orders')
      .select('reference,email,status,total_cents,payment_method,created_at,games(name),packages(name)')
      .order('created_at', { ascending: false })
      .limit(500)
      .eq('is_archived', false);
    const rows = (data || []) as unknown as Array<Record<string, unknown>>;
    const header = 'Reference,Email,Status,Total,PaymentMethod,Game,Package,CreatedAt';
    const body = rows.map((r) => [r.reference, r.email, r.status, r.total_cents, r.payment_method, (r.games as { name: string } | null)?.name || '', (r.packages as { name: string } | null)?.name || '', r.created_at].map(csvField).join(',')).join('\n');
    return new NextResponse(`${header}\n${body}`, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="orders.csv"' } });
  }

  const { data: games } = await db.from('games').select('*').order('sort_order');
  const { data: packages } = await db.from('packages').select('name,sku,price_cents,original_price_cents,is_active,games(name)').order('sort_order');
  const header = 'Type,Name,Slug/SKU,Price,OriginalPrice,Active';
  const gameRows = ((games || []) as Array<Record<string, unknown>>).map((g) => `Game,"${g.name}","${g.slug}",,,,${g.is_active}`);
  const pkgRows = ((packages || []) as unknown as Array<Record<string, unknown>>).map((p) => `Package,"${p.name}","${p.sku}",${p.price_cents},${p.original_price_cents || ''},${p.is_active}`);
  return new NextResponse(`${header}\n${gameRows.join('\n')}\n${pkgRows.join('\n')}`, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="catalog.csv"' } });
}

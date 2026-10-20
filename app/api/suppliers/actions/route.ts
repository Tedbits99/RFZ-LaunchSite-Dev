import { NextRequest, NextResponse } from 'next/server';
import { testSupplierConnection, checkSupplierBalance, syncSupplierCatalog } from '@/lib/suppliers/fulfillment';
import { requireAdmin } from '@/lib/adminGuard';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const body = await req.json();
  const { action, supplier_id } = body;

  if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 });

  try {
    switch (action) {
      case 'test_connection': {
        const result = await testSupplierConnection(supplier_id);
        return NextResponse.json(result);
      }
      case 'check_balance': {
        const result = await checkSupplierBalance(supplier_id);
        return NextResponse.json(result);
      }
      case 'sync_catalog': {
        const result = await syncSupplierCatalog(supplier_id);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Action failed' }, { status: 500 });
  }
}

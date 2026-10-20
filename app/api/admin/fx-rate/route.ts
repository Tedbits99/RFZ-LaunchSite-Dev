import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminGuard';

/**
 * Fetch the live USD→PHP exchange rate from a free, no-key-required API.
 * Falls back gracefully if the API is unreachable, returning the last
 * saved rate from app_settings so the client can preserve the latest
 * valid value.
 */
export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (!session.ok) return session.response;

  try {
    // open.er-api.com is a free, open-access FX API with no API key required.
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { Accept: 'application/json' },
      // 8-second timeout — don't block the admin page too long
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'FX API returned an error', live_rate: null }, { status: 502 });
    }

    const data = await res.json();
    const phpRate = data?.rates?.PHP;

    if (typeof phpRate !== 'number' || phpRate <= 0) {
      return NextResponse.json({ error: 'USD→PHP rate not found in FX API response', live_rate: null }, { status: 502 });
    }

    return NextResponse.json({ live_rate: Math.round(phpRate * 100) / 100 });
  } catch {
    return NextResponse.json({ error: 'Could not reach the live FX API', live_rate: null }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';

// Simple in-memory rate limiting per email/IP for voucher validation.
// Tracks attempts in a sliding window. This is per-instance (not shared across
// edge instances) but provides basic brute-force protection for the common case.
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_ATTEMPTS = 10;
const rateMap = new Map<string, { count: number; firstAt: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now - entry.firstAt > RATE_WINDOW_MS) {
    rateMap.set(key, { count: 1, firstAt: now });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_MAX_ATTEMPTS) {
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const body = await req.json();
    const { code, packageId, gameId, email } = body as {
      code?: string;
      packageId?: string;
      gameId?: string;
      email?: string;
    };

    const rateKey = `${ip}:${email || 'anon'}`;
    if (!rateLimit(rateKey)) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again in a minute.' },
        { status: 429 }
      );
    }

    if (!code || typeof code !== 'string' || !code.trim()) {
      return NextResponse.json({ error: 'Please enter a voucher code.' }, { status: 400 });
    }
    if (!packageId || !gameId) {
      return NextResponse.json({ error: 'Missing product information.' }, { status: 400 });
    }
    const db = adminSupabase || supabase;
    if (!db) {
      return NextResponse.json({ error: 'Service unavailable.' }, { status: 503 });
    }

    // Server-side: load the actual package price from the database.
    // Never trust a subtotal from the frontend.
    const { data: pkg, error: pkgError } = await db
      .from('packages')
      .select('id, price_cents, game_id, is_active')
      .eq('id', packageId)
      .maybeSingle();

    if (pkgError || !pkg || !pkg.is_active || pkg.game_id !== gameId) {
      return NextResponse.json({ error: 'The selected package is no longer available.' }, { status: 400 });
    }

    const subtotalCents = pkg.price_cents;

    const normalizedCode = code.trim().toUpperCase();

    // The SECURITY DEFINER function holds all the validation rules and
    // returns the specific failure reason (expired, usage limit, already
    // used, minimum order, wrong game, inactive) — the same rules the
    // atomic create_order function enforces, so they can never disagree.
    const { data, error } = await db.rpc('validate_voucher', {
      p_code: normalizedCode,
      p_subtotal_cents: subtotalCents,
      p_game_id: gameId,
      p_email: email ? String(email).trim().toLowerCase() : null,
    });

    const result = (Array.isArray(data) ? data[0] : data) as
      | { out_valid: boolean; out_error: string | null; out_discount_cents: number; out_total_cents: number }
      | undefined;

    if (error || !result) {
      return NextResponse.json({ error: 'Could not check this voucher. Please try again.' }, { status: 500 });
    }

    if (!result.out_valid) {
      return NextResponse.json({ error: result.out_error || 'Invalid voucher code.' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      voucher: { code: normalizedCode },
      subtotal: subtotalCents,
      discount: result.out_discount_cents,
      total: result.out_total_cents,
    });
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

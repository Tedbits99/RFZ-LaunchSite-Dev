import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { adminSupabase } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderReference, email, paymentMethod, referenceNumber, note, proofUrl } = body;

    if (!orderReference || !email) {
      return NextResponse.json({ error: 'Order reference and email are required.' }, { status: 400 });
    }

    if (proofUrl && proofUrl.length > 5_000_000) {
      return NextResponse.json({ error: 'Payment proof image is too large. Please use a smaller image.' }, { status: 400 });
    }

    const client = adminSupabase || supabase;
    if (!client) {
      return NextResponse.json({ error: 'Service is not configured. Please contact support.' }, { status: 503 });
    }

    const { data, error } = await client.rpc('submit_payment', {
      p_order_reference: orderReference,
      p_email: email,
      p_payment_method: paymentMethod || null,
      p_reference_number: referenceNumber || null,
      p_note: note || null,
      p_proof_url: proofUrl || null,
    });

    if (error) {
      console.error('submit_payment rpc error:', error.message);
      return NextResponse.json({ error: 'Could not submit payment information.' }, { status: 500 });
    }

    const row = (data as Array<{ out_success: boolean; out_error: string | null }>)[0];
    if (!row || !row.out_success) {
      return NextResponse.json({ error: row?.out_error || 'Could not submit payment.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Payment submitted. Your order is pending verification.' });
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

/*
  Server-side transactional email helper for Next.js routes.

  Calls the send-transactional-email Edge Function, which holds the SMTP
  credentials (Titan Business Email) as Edge Function secrets. This keeps
  SMTP credentials out of the Next.js bundle and in one place.

  Duplicate prevention is enforced by the email_sent_log unique constraint
  on (order_id, template) inside the edge function.
*/

interface EmailPayload {
  order_id: string;
  template: 'payment_success' | 'fulfillment_failed';
  to: string;
  order_reference: string;
  customer_name: string;
  package_name: string;
  total_php: string;
  error_detail?: string;
}

interface OrderEmailData {
  order_id: string;
  to: string;
  order_reference: string;
  customer_name: string;
  package_name: string;
  total_php: string;
}

// Use `unknown` for the db param to avoid deep type instantiation with
// Supabase's complex generics. The callers pass a real Supabase client.
async function loadOrderForEmail(
  db: unknown,
  orderId: string,
): Promise<OrderEmailData | null> {
  const supabase = db as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: unknown }>;
        };
      };
    };
  };
  const { data: order } = await supabase
    .from('orders')
    .select('id, reference, email, customer_name, total_cents, package_id')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return null;
  const o = order as Record<string, unknown>;
  let packageName = '';
  if (o.package_id) {
    const { data: pkg } = await supabase
      .from('packages')
      .select('name')
      .eq('id', o.package_id as string)
      .maybeSingle();
    packageName = (pkg as Record<string, unknown>)?.name as string || '';
  }
  const totalCents = o.total_cents as number;
  const totalPhp = `₱${(totalCents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  return {
    order_id: orderId,
    to: o.email as string,
    order_reference: o.reference as string,
    customer_name: o.customer_name as string,
    package_name: packageName,
    total_php: totalPhp,
  };
}

export async function sendPaymentSuccessEmail(
  db: unknown,
  orderId: string,
): Promise<void> {
  try {
    const orderData = await loadOrderForEmail(db, orderId);
    if (!orderData || !orderData.to) return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;

    const payload: EmailPayload = { ...orderData, template: 'payment_success' };
    await fetch(`${url}/functions/v1/send-transactional-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Email failure must not affect order processing
  }
}

export async function sendFulfillmentFailedEmail(
  db: unknown,
  orderId: string,
  errorDetail: string,
): Promise<void> {
  try {
    const orderData = await loadOrderForEmail(db, orderId);
    if (!orderData || !orderData.to) return;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;

    const payload: EmailPayload = { ...orderData, template: 'fulfillment_failed', error_detail: errorDetail };
    await fetch(`${url}/functions/v1/send-transactional-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Email failure must not affect order processing
  }
}

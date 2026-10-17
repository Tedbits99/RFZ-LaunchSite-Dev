import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { adminSupabase } from '@/lib/supabaseAdmin';

export function hashOrderCapability(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function orderCapabilityCookieName(reference: string): string {
  return `rfz-order-${reference.trim().toLowerCase()}`;
}

export async function verifyOrderCapability(
  orderId: string,
  reference: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token || !adminSupabase || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return false;

  const { data, error } = await adminSupabase
    .from('guest_order_access')
    .select('order_id')
    .eq('order_id', orderId)
    .eq('token_hash', hashOrderCapability(token))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  return !error && data?.order_id === orderId && Boolean(reference);
}

/**
 * Authorize an order API request. A recognized but invalid Supabase session
 * never degrades to guest capability access. The HttpOnly capability is used
 * for guest orders and for same-browser checkout access.
 */
export async function authorizeOrderRequest(
  req: NextRequest,
  order: { id: string; reference: string; customer_user_id?: string | null },
): Promise<boolean> {
  const authCookiePresent = req.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
  if (authCookiePresent) {
    try {
      const authClient = createSupabaseServerClient();
      const { data, error } = await authClient.auth.getUser();
      if (error || !data.user) return false;
      if (order.customer_user_id && order.customer_user_id === data.user.id) return true;
      if (data.user.email_confirmed_at && adminSupabase) {
        const { data: admin } = await adminSupabase
          .from('admins')
          .select('id')
          .eq('id', data.user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (admin) return true;
      }
    } catch {
      return false;
    }
  }

  const token = req.cookies.get(orderCapabilityCookieName(order.reference))?.value;
  return verifyOrderCapability(order.id, order.reference, token);
}

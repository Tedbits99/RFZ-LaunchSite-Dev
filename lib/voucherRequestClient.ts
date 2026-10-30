import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCustomerServerClient } from '@/lib/authSessionClients';
import { supabase } from '@/lib/supabase';

export type VoucherRequestIdentity =
  | { ok: true; client: SupabaseClient; email: string | null; authenticated: boolean; userId: string | null }
  | { ok: false; status: number; error: string };

export async function voucherRequestIdentity(req: NextRequest): Promise<VoucherRequestIdentity> {
  const hasCustomerCookie = req.cookies.getAll().some(({ name }) => /^rfz-customer-auth(?:\.\d+)?$/.test(name));
  if (hasCustomerCookie) {
    try {
      const client = await createCustomerServerClient();
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || !data.user.email_confirmed_at || !data.user.email) {
        return { ok: false, status: 401, error: 'Your customer session could not be verified.' };
      }
      const { data: profile, error: profileError } = await client.from('customer_profiles')
        .select('status').eq('user_id', data.user.id).maybeSingle();
      if (profileError || profile?.status !== 'active') {
        return { ok: false, status: 403, error: 'Your account is not eligible for promotions.' };
      }
      return { ok: true, client, email: data.user.email, authenticated: true, userId: data.user.id };
    } catch {
      return { ok: false, status: 401, error: 'Your customer session could not be verified.' };
    }
  }
  if (!supabase) return { ok: false, status: 503, error: 'Promotion service is unavailable.' };
  return { ok: true, client: supabase, email: null, authenticated: false, userId: null };
}

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sessionCookieName, type AuthSessionContext } from '@/lib/authSessionConfig';

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured.');
  return { url, anonKey };
}

function browserOptions(context: AuthSessionContext) {
  return {
    cookieOptions: { name: sessionCookieName(context) },
    cookieEncoding: 'base64url' as const,
    isSingleton: false,
  };
}

export function createCustomerBrowserClient(): SupabaseClient {
  const { url, anonKey } = supabaseConfig();
  return createBrowserClient(url, anonKey, browserOptions('customer'));
}

export function createAdminBrowserClient(): SupabaseClient {
  const { url, anonKey } = supabaseConfig();
  return createBrowserClient(url, anonKey, browserOptions('admin'));
}

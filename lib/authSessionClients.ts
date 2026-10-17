import { cookies } from 'next/headers';
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sessionCookieName, type AuthSessionContext } from '@/lib/authSessionConfig';

type CookieToSet = { name: string; value: string; options: CookieOptions };

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
    // The existing browser factory is a singleton. These isolated factories
    // must never share that cache across customer/admin contexts.
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

function createServerClientForContext(context: AuthSessionContext) {
  const { url, anonKey } = supabaseConfig();
  let cookieStore: ReturnType<typeof cookies> | null = null;
  try {
    cookieStore = cookies();
  } catch {
    cookieStore = null;
  }

  return createServerClient(url, anonKey, {
    cookieOptions: { name: sessionCookieName(context) },
    cookieEncoding: 'base64url',
    cookies: {
      getAll() {
        if (!cookieStore) return [];
        try {
          return cookieStore.getAll();
        } catch {
          return [];
        }
      },
      setAll(cookiesToSet: CookieToSet[]) {
        if (!cookieStore) return;
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore!.set(name, value, options));
        } catch {
          // Server Component cookie stores can be read-only. Route handlers
          // and middleware remain responsible for persisting refresh changes.
        }
      },
    },
  });
}

export function createCustomerServerClient() {
  return createServerClientForContext('customer');
}

export function createAdminServerClient() {
  return createServerClientForContext('admin');
}

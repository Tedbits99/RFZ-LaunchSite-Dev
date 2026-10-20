import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sessionCookieName, type AuthSessionContext } from '@/lib/authSessionConfig';
export {
  createCustomerBrowserClient,
  createAdminBrowserClient,
  createRecoveryBrowserClient,
} from '@/lib/authSessionBrowserClients';

type CookieToSet = { name: string; value: string; options: CookieOptions };

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase is not configured.');
  return { url, anonKey };
}

async function createServerClientForContext(context: AuthSessionContext) {
  const { url, anonKey } = supabaseConfig();
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
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

export async function createCustomerServerClient() {
  return createServerClientForContext('customer');
}

export async function createAdminServerClient() {
  return createServerClientForContext('admin');
}

export async function createRecoveryServerClient() {
  return createServerClientForContext('recovery');
}

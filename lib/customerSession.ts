import type { User } from '@supabase/supabase-js';
import { createCustomerServerClient } from '@/lib/authSessionClients';

type CustomerProfile = {
  user_id: string;
  status: string;
};

export type ActiveCustomerSession = {
  client: ReturnType<typeof createCustomerServerClient>;
  user: User;
  profile: CustomerProfile;
};

/**
 * Resolve only an email-confirmed, active customer through the customer
 * namespace. Profile and order reads must remain RLS-backed; this helper never
 * falls back to the service-role client.
 */
export async function getActiveCustomerSession(): Promise<ActiveCustomerSession | null> {
  try {
    const client = createCustomerServerClient();
    const { data: userData, error: userError } = await client.auth.getUser();
    const user = userData.user;
    if (userError || !user || !user.email_confirmed_at) return null;

    const { data: profile, error: profileError } = await client
      .from('customer_profiles')
      .select('user_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileError || !profile || profile.status !== 'active') return null;
    return { client, user, profile: profile as CustomerProfile };
  } catch {
    return null;
  }
}

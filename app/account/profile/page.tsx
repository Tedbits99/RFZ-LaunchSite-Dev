import { redirect } from 'next/navigation';
import ProfileClient from './ProfileClient';
import { getActiveCustomerSession } from '@/lib/customerSession';

export const dynamic = 'force-dynamic';

export default async function AccountProfile() {
  const session = await getActiveCustomerSession();
  if (!session) redirect('/login');

  return <ProfileClient />;
}

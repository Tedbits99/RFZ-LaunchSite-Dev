import { notFound } from 'next/navigation';
import { PageHeader, Surface } from '@/components/admin/ui';
import { getAdminSession } from '@/lib/adminGuard';
import RfCoinsClient from './RfCoinsClient';

export const dynamic = 'force-dynamic';

export default async function AdminRfCoinsPage() {
  const session = await getAdminSession();
  if (!session || session.role !== 'SUPER_ADMIN') notFound();

  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader
        title="RF Coins Center"
        subtitle="Wallet liability, customer balances, package configuration, and audited operations. Financial release remains locked."
      />
      <Surface className="mb-5 border-amber-400/20 bg-amber-400/5 p-4">
        <p className="text-sm font-semibold text-amber-200">Wallet funding is awaiting financial release approval.</p>
        <p className="mt-1 text-xs leading-5 text-[var(--rfz-muted)]">
          This console is restricted to active Super Admins. Funding and wallet spending are disabled by application and database release locks; database settings cannot enable either capability.
        </p>
      </Surface>
      <RfCoinsClient />
    </main>
  );
}

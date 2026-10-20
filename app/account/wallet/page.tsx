import SiteFooter from '@/components/SiteFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import WalletClient from './WalletClient';
import AccountHeader from '@/components/account/AccountHeader';

export const dynamic = 'force-dynamic';

export default async function WalletPage() {
  const session = await getActiveCustomerSession();
  if (!session) redirect('/login');

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <AccountHeader backHref="/account" backLabel="My Account" />
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <h1 className="font-display text-3xl font-bold">RF Coins Wallet</h1>
        <p className="mt-2 text-sm text-slate-400">Balance, coin packages and your transaction history.</p>
        <div className="mt-8"><WalletClient /></div>
      </div>
      <SiteFooter />
    </main>
  );
}

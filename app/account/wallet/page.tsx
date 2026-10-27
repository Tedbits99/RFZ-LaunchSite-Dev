import AccountFooter from '@/components/account/AccountFooter';
import { redirect } from 'next/navigation';
import { getActiveCustomerSession } from '@/lib/customerSession';
import WalletClient from './WalletClient';
import ThemeSelector from '@/components/ThemeSelector';
import { getCustomerLoginUrl } from '@/lib/authRedirect';

export const dynamic = 'force-dynamic';

export default async function WalletPage() {
  const session = await getActiveCustomerSession();
  if (!session) redirect(getCustomerLoginUrl('/account/wallet'));

  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-4"><a href="/account" className="text-xs text-cyan-300">&larr; My Account</a><ThemeSelector /></div></header>
      <div className="mx-auto max-w-[1180px] px-5 py-10">
        <h1 className="font-display text-3xl font-bold">RF Coins Wallet</h1>
        <p className="mt-2 text-sm text-slate-400">Balance, coin packages and your transaction history.</p>
        <div className="mt-8"><WalletClient /></div>
      </div>
      <AccountFooter />
    </main>
  );
}

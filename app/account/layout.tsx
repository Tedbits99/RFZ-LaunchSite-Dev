import type { ReactNode } from 'react';
import AccountNavigation from '@/components/AccountNavigation';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#030718] lg:pl-64">
      <AccountNavigation />
      {children}
    </div>
  );
}

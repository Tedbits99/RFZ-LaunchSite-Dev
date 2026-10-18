import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';

export default function AccountProfile() {
  return (
    <main className="min-h-screen bg-[#030718] text-slate-100">
      <header className="border-b border-[#14203a] bg-[#050a1b]/90"><div className="mx-auto max-w-[1180px] px-5 py-4"><a href="/account" className="text-xs text-cyan-300">← Account</a></div></header>
      <div className="mx-auto max-w-2xl px-5 py-10">
        <nav className="flex items-center gap-2 text-xs text-slate-500"><Link href="/account">Account</Link><ChevronRight size={12} /><span className="text-slate-300">Profile</span></nav>
        <h1 className="font-display mt-4 text-2xl font-bold">Profile Settings</h1>
        <div className="mt-6 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6 text-sm text-slate-400">
          Profile editing is not available yet. Your account and order history remain protected by your verified customer session.
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

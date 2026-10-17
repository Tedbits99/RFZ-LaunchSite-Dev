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
        <form className="mt-6 space-y-4 rounded-xl border border-[#1b2a45] bg-[#0b1225] p-6">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Full name</span><input defaultValue="Guest Customer" className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Email</span><input type="email" defaultValue="guest@runfazone.com" className="w-full rounded-lg border border-[#22314d] bg-[#0a1124] px-3 py-2.5 text-sm outline-none focus:border-cyan-400" /></label>
          <button type="button" className="rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-5 py-2.5 text-sm font-semibold">Save Changes</button>
        </form>
      </div>
      <SiteFooter />
    </main>
  );
}

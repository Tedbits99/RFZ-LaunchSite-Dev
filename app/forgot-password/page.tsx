import Link from 'next/link';
import { Mail } from 'lucide-react';

export default function ForgotPassword() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        <h1 className="font-display text-2xl font-bold">Reset password</h1>
        <p className="mt-1 text-sm text-slate-400">We&apos;ll send you a reset link.</p>
        <form className="mt-6 space-y-3">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Email</span><div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3"><Mail size={15} className="text-slate-500" /><input type="email" required className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
          <button className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold">Send Reset Link</button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500"><Link href="/login" className="text-cyan-300">Back to sign in</Link></p>
      </div>
    </main>
  );
}

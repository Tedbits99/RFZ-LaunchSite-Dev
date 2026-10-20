'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';

type PageState = 'idle' | 'pending' | 'sent' | 'error';

const GENERIC_OK = 'If the address can receive mail, reset instructions will be sent.';
const GENERIC_503 = 'Password reset is temporarily unavailable.';

export default function ForgotPassword() {
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState<string>('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setError('');

    const email = new FormData(event.currentTarget).get('email');
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email }),
      });
      if (res.status === 202) {
        setState('sent');
        return;
      }
      if (res.status === 400) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || 'Please provide a valid email address.');
        setState('error');
        return;
      }
      setError(GENERIC_503);
      setState('error');
    } catch {
      setError(GENERIC_503);
      setState('error');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a2e] bg-[#0b1225] p-8">
        {state === 'sent' ? (
          <div className="text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="font-display mt-3 text-2xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{GENERIC_OK}</p>
              <Link href="/login" className="mt-6 inline-block rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-300 transition-colors hover:border-[#31456b] hover:text-slate-100">Back to sign in</Link>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Reset password</h1>
            <p className="mt-1 text-sm text-slate-400">We&apos;ll send you a reset link.</p>
            <form className="mt-6 space-y-3" onSubmit={submit}>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Email</span><div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3"><Mail size={15} className="text-slate-500" /><input name="email" type="email" required className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
              {state === 'error' && error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert" aria-live="polite">{error}</div>
              ) : null}
              <button type="submit" disabled={state === 'pending'} className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50">
                {state === 'pending' ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500"><Link href="/login" className="text-cyan-300">Back to sign in</Link></p>
          </>
        )}
      </div>
    </main>
  );
}

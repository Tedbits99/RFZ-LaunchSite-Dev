'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setAwaitingConfirmation(false);
    setSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        // A 403 is also returned when the request origin is rejected; only the
        // unconfirmed-email message should offer the resend path.
        if (response.status === 403 && body.error === 'Please confirm your email address to activate your account.') {
          setAwaitingConfirmation(true);
        }
        setError(body.error || 'Unable to sign in.');
        return;
      }
      router.replace('/account');
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        <h1 className="font-display text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Access your RunFazone account and order history.</p>
        <form className="mt-6 space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Email</span>
            <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
              <Mail size={15} className="text-slate-500" />
              <input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} className="w-full bg-transparent py-2.5 text-sm outline-none" />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Password</span>
            <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
              <Lock size={15} className="text-slate-500" />
              <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} className="w-full bg-transparent py-2.5 text-sm outline-none" />
            </div>
          </label>
          <button type="submit" disabled={submitting} className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50">
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p className="mt-3 text-center text-xs"><Link href="/forgot-password" className="text-cyan-300 hover:text-cyan-200">Forgot your password?</Link></p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-center text-sm text-rose-200">{error}</p>}
        {awaitingConfirmation && (
          <p className="mt-3 text-center text-xs text-slate-400">
            Didn&apos;t get the email or the link expired?{' '}
            <a href={`/auth/confirmation?status=pending&email=${encodeURIComponent(email)}`} className="text-cyan-300">Resend the confirmation email</a>
          </p>
        )}
        <p className="mt-4 text-center text-xs text-slate-500">New to RunFazone? <Link href="/register" className="text-cyan-300">Create Account</Link></p>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TextInput } from '@/components/ui';
import ThemeSelector from '@/components/ThemeSelector';
import PasswordInput from '@/components/PasswordInput';
import { getSafeInternalPath } from '@/lib/authRedirect';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'restricted') setError('This account is not available for customer access.');
    if (params.get('reset') === 'success') setError('Your password was updated. Sign in with your new password.');
    const controller = new AbortController();
    fetch('/api/account/profile', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (response.ok && params.get('auth') !== 'restricted') router.replace(getSafeInternalPath(params.get('next')));
      })
      .catch(() => { /* Keep the login form available when session lookup is unavailable. */ });
    return () => controller.abort();
  }, [router]);

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
      const params = new URLSearchParams(window.location.search);
      const destination = getSafeInternalPath(params.get('next'));
      try { window.sessionStorage.removeItem('rfz-customer-signed-out'); } catch { /* Storage can be disabled. */ }
      router.replace(destination);
    } catch {
      setError('Unable to sign in right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="rfz-auth-page grid min-h-screen w-full min-w-0 place-items-center bg-[#030718] px-5 py-8 text-slate-100">
      <div className="surface w-full min-w-0 max-w-sm p-6 sm:p-8">
        <div className="mb-5 flex justify-end"><ThemeSelector /></div>
        <h1 className="font-display text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">Access your RunFazone account.</p>
        <form className="mt-6 space-y-3" onSubmit={submit}>
          <TextInput label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} placeholder="you@example.com" />
          <PasswordInput label="Password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} placeholder="Your password" />
          <div className="text-right"><Link href="/forgot-password" className="text-xs text-cyan-300 hover:underline">Forgot password?</Link></div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-center text-sm text-rose-200">{error}</p>}
        {awaitingConfirmation && (
          <p className="mt-3 text-center text-xs text-slate-400">
            Didn&apos;t get the email or the link expired?{' '}
            <a href={`/auth/confirmation?status=pending&email=${encodeURIComponent(email)}`} className="text-cyan-300">Resend the confirmation email</a>
          </p>
        )}
        <p className="mt-5 text-center text-xs text-slate-500">Don&apos;t have an account? <Link href="/register" className="text-cyan-300">Sign up</Link></p>
      </div>
    </main>
  );
}

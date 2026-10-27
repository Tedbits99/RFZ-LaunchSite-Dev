'use client';

import { FormEvent, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import PasswordInput from '@/components/PasswordInput';

type PageState = 'form' | 'pending' | 'success' | 'error';

const GENERIC_INVALID = 'This reset link is invalid or has expired. Please request a new one.';
const GENERIC_OK = 'Password updated. You can now sign in with your new password.';
const GENERIC_503 = 'Password reset is temporarily unavailable. Please try again later.';

export default function ResetPasswordPage() {
  const [state, setState] = useState<PageState>('form');
  const [error, setError] = useState<string>('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setError('');

    const password = String(new FormData(event.currentTarget).get('password') ?? '');

    try {
      // The password change happens server-side: the endpoint re-verifies the
      // recovery-namespace session and the signed HttpOnly proof cookie. The
      // browser never calls the Auth provider directly and never touches the
      // proof cookie itself.
      const response = await fetch('/auth/reset-password/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });

      if (response.ok) {
        setState('success');
        return;
      }
      if (response.status === 503) {
        setError(GENERIC_503);
      } else {
        setError(GENERIC_INVALID);
      }
      setState('error');
    } catch {
      setError(GENERIC_503);
      setState('error');
    }
  }

  return (
    <main className="rfz-auth-page grid min-h-screen place-items-center bg-[#030718] px-5 py-8 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        {state === 'success' ? (
          <div className="text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="font-display mt-3 text-2xl font-bold">Password set</h1>
            <p className="mt-2 text-sm text-slate-400">{GENERIC_OK}</p>
            <a href="/login?reset=success" className="mt-6 inline-block rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-300 transition-colors hover:border-[#31456b] hover:text-slate-100">Sign in</a>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Choose a new password</h1>
            <p className="mt-1 text-sm text-slate-400">Enter a new password for your account.</p>
            <form className="mt-6 space-y-3" onSubmit={submit}>
              <PasswordInput label="New password" name="password" autoComplete="new-password" required minLength={8} maxLength={128} />
              {state === 'error' && error ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{error}</div>
              ) : null}
              <button type="submit" disabled={state === 'pending'} className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold disabled:opacity-50">
                {state === 'pending' ? 'Updating…' : 'Update password'}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500"><a href="/login" className="text-cyan-300">Back to sign in</a></p>
          </>
        )}
      </div>
    </main>
  );
}

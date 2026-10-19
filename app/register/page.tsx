'use client';

import { FormEvent, useState } from 'react';
import { Mail, Lock, UserRound, CheckCircle2, AlertCircle } from 'lucide-react';

type SubmitState = 'idle' | 'pending' | 'success' | 'error';

const successMessage = 'If the address can receive mail, confirmation instructions will be sent.';
const genericError = 'Registration is temporarily unavailable. Please try again later.';

export default function Register() {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === 'pending') return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '');
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setSubmitState('pending');
    setErrorMessage('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      if (res.status === 202) {
        form.reset();
        setSubmitState('success');
        return;
      }

      if (res.status === 400) {
        let message = genericError;
        try {
          const body: unknown = await res.json();
          if (body && typeof body === 'object' && 'error' in body) {
            const apiError = (body as { error?: unknown }).error;
            if (typeof apiError === 'string' && apiError.length > 0 && apiError.length < 200) {
              message = apiError;
            }
          }
        } catch {
          // keep generic message
        }
        setErrorMessage(message);
        setSubmitState('error');
        return;
      }

      setErrorMessage(genericError);
      setSubmitState('error');
    } catch {
      setErrorMessage(genericError);
      setSubmitState('error');
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#030718] px-5 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-[#1b2a45] bg-[#0b1225] p-8">
        {submitState === 'success' ? (
          <div className="text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
            <h1 className="font-display mt-3 text-2xl font-bold">Almost there</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{successMessage}</p>
            <a
              href="/login"
              className="mt-6 inline-block rounded-lg border border-[#22314d] px-4 py-2 text-sm text-slate-300 transition-colors hover:border-[#31456b] hover:text-slate-100"
            >
              Back to login
            </a>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold">Create account</h1>
            <p className="mt-1 text-sm text-slate-400">Join RunFazone for faster top-ups.</p>
            <form className="mt-6 space-y-3" onSubmit={handleSubmit} noValidate={false}>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Full name</span><div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3"><UserRound size={15} className="text-slate-500" /><input name="name" required className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Email</span><div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3"><Mail size={15} className="text-slate-500" /><input name="email" type="email" required className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
              <label className="block"><span className="mb-1 block text-xs text-slate-400">Password</span><div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3"><Lock size={15} className="text-slate-500" /><input name="password" type="password" required className="w-full bg-transparent py-2.5 text-sm outline-none" /></div></label>
              {submitState === 'error' && errorMessage ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-xs text-red-300" role="alert">
                  <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-400" />
                  <span>{errorMessage}</span>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={submitState === 'pending'}
                className="w-full rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitState === 'pending' ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
            <p className="mt-4 text-center text-xs text-slate-500">
              Already have an account? <a href="/login" className="text-slate-300 underline-offset-2 transition-colors hover:text-slate-100 hover:underline">Sign in</a>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

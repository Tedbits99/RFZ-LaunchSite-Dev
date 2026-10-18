'use client';

import { FormEvent, useState } from 'react';
import { Mail, CheckCircle2, RefreshCw } from 'lucide-react';

export const GENERIC_SENT = 'If the address can receive mail, confirmation instructions will be sent.';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 320;

export type ResendOutcome =
  | { kind: 'sent' }
  | { kind: 'invalid-email' }
  | { kind: 'security' }
  | { kind: 'rate-limited'; retryAfterSeconds?: number }
  | { kind: 'unavailable' }
  | { kind: 'network' };

function normalizeRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 86400) {
    return undefined;
  }
  return Math.ceil(value);
}

export async function requestConfirmationResend(
  email: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendOutcome> {
  if (typeof email !== 'string') return { kind: 'invalid-email' };
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    return { kind: 'invalid-email' };
  }

  let res: Response;
  try {
    res = await fetchImpl('/api/auth/resend-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: normalized }),
    });
  } catch {
    return { kind: 'network' };
  }

  if (res.status === 202) return { kind: 'sent' };
  if (res.status === 400) return { kind: 'invalid-email' };
  if (res.status === 403) return { kind: 'security' };
  if (res.status === 429) {
    const body = await res.json().catch(() => ({})) as { retry_after_seconds?: unknown };
    return { kind: 'rate-limited', retryAfterSeconds: normalizeRetryAfter(body.retry_after_seconds) };
  }
  return { kind: 'unavailable' };
}

type FormState = 'idle' | 'pending' | 'done' | 'error';

type FormProps = { initialEmail?: string };

export default function ResendConfirmationForm({ initialEmail }: FormProps = {}) {
  const [state, setState] = useState<FormState>('idle');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'pending') return;
    setState('pending');
    setFeedback(null);

    const outcome = await requestConfirmationResend(new FormData(event.currentTarget).get('email'));

    if (outcome.kind === 'sent') {
      setFeedback({ tone: 'ok', text: GENERIC_SENT });
      setState('done');
      return;
    }
    if (outcome.kind === 'invalid-email') {
      setFeedback({ tone: 'error', text: 'Please provide a valid email address.' });
      setState('error');
      return;
    }
    if (outcome.kind === 'rate-limited') {
      const wait = outcome.retryAfterSeconds
        ? ` Please wait about ${Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60))} minute(s) before trying again.`
        : ' Please try again later.';
      setFeedback({ tone: 'error', text: `Too many requests.${wait}` });
      setState('error');
      return;
    }
    if (outcome.kind === 'security') {
      setFeedback({ tone: 'error', text: 'Your request could not be verified. Please return to the site and try again.' });
      setState('error');
      return;
    }
    if (outcome.kind === 'network') {
      setFeedback({ tone: 'error', text: 'We could not reach the server. Please check your connection and try again.' });
      setState('error');
      return;
    }
    setFeedback({ tone: 'error', text: 'Confirmation resend is temporarily unavailable. Please try again later.' });
    setState('error');
  }

  return (
    <div className="mt-8 border-t border-[#1b2a45] pt-6">
      <h2 className="text-sm font-semibold text-slate-200">Resend confirmation email</h2>
      <p className="mt-1 text-xs text-slate-500">Enter the email address you registered with.</p>
      <form className="mt-4 space-y-3" onSubmit={submit} noValidate>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Email</span>
          <div className="flex items-center gap-2 rounded-lg border border-[#22314d] bg-[#0a1124] px-3">
            <Mail size={15} className="text-slate-500" />
            <input name="email" type="email" autoComplete="email" defaultValue={initialEmail ?? ''} className="w-full bg-transparent py-2.5 text-sm outline-none" />
          </div>
        </label>
        {feedback ? (
          <div
            className={
              feedback.tone === 'ok'
                ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200'
                : 'rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200'
            }
            role="status"
            aria-live="polite"
          >
            {feedback.text}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={state === 'pending'}
          className="inline-flex items-center gap-2 rounded-lg border border-[#22314d] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-[#31456b] hover:text-white disabled:opacity-50"
        >
          {state === 'pending' ? <RefreshCw size={15} className="animate-spin" /> : null}
          {state === 'pending' ? 'Sending…' : 'Resend confirmation email'}
        </button>
      </form>
    </div>
  );
}
